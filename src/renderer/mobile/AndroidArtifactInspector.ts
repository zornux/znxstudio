/**
 * Android artifact inspector (Phase 6).
 *
 * Inspects APK/AAB artifacts for:
 *   - AndroidManifest.xml content (permissions, activities, metadata)
 *   - Signing verification (scheme, key, certificate)
 *   - Simulator config contamination
 *   - Debug/release mode detection
 *   - Package structure validation
 *   - Extension-backed build verification
 *
 * Security constraint: simulator mocks, overrides, presets, test telemetry,
 * screenshots, and debugging state must NEVER enter APK/AAB artifacts.
 */
import type {
  ManifestInspection,
  ManifestActivity,
  SigningVerification,
  SigningScheme,
  ContaminationFinding,
  ContaminationType,
  BuildArtifact,
  ArtifactFormat,
  BuildMode,
} from '../../shared/androidE2ETypes';
import {
  createManifestInspection,
  createSigningVerification,
  CONTAMINATION_PATTERNS,
} from '../../shared/androidE2ETypes';

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

export function parseManifestXml(xml: string): ManifestInspection {
  const manifest = createManifestInspection();

  const pkgMatch = xml.match(/package="([^"]+)"/);
  if (pkgMatch) manifest.packageName = pkgMatch[1];

  const versionNameMatch = xml.match(/android:versionName="([^"]+)"/);
  if (versionNameMatch) manifest.versionName = versionNameMatch[1];

  const versionCodeMatch = xml.match(/android:versionCode="(\d+)"/);
  if (versionCodeMatch) manifest.versionCode = parseInt(versionCodeMatch[1], 10);

  const minSdkMatch = xml.match(/android:minSdkVersion="(\d+)"/);
  if (minSdkMatch) manifest.minSdkVersion = parseInt(minSdkMatch[1], 10);

  const targetSdkMatch = xml.match(/android:targetSdkVersion="(\d+)"/);
  if (targetSdkMatch) manifest.targetSdkVersion = parseInt(targetSdkMatch[1], 10);

  const debugMatch = xml.match(/android:debuggable="(true|false)"/);
  if (debugMatch) manifest.debuggable = debugMatch[1] === 'true';

  const backupMatch = xml.match(/android:allowBackup="(true|false)"/);
  if (backupMatch) manifest.allowBackup = backupMatch[1] === 'true';

  const permRegex = /<uses-permission\s+android:name="([^"]+)"/g;
  let permMatch;
  while ((permMatch = permRegex.exec(xml)) !== null) {
    manifest.permissions.push(permMatch[1]);
  }

  const activityRegex = /<activity\s+([^>]+)>/g;
  let actMatch;
  while ((actMatch = activityRegex.exec(xml)) !== null) {
    const attrs = actMatch[1];
    const nameM = attrs.match(/android:name="([^"]+)"/);
    const exportedM = attrs.match(/android:exported="(true|false)"/);
    const launchM = attrs.match(/android:launchMode="([^"]+)"/);
    const isLauncher = xml.substring(actMatch.index, actMatch.index + 500).includes('android.intent.action.MAIN');
    manifest.activities.push({
      name: nameM ? nameM[1] : '',
      exported: exportedM ? exportedM[1] === 'true' : false,
      launchMode: launchM ? launchM[1] : 'standard',
      isLauncher,
    });
  }

  const serviceRegex = /<service\s+android:name="([^"]+)"/g;
  let svcMatch;
  while ((svcMatch = serviceRegex.exec(xml)) !== null) {
    manifest.services.push(svcMatch[1]);
  }

  const receiverRegex = /<receiver\s+android:name="([^"]+)"/g;
  let rcvMatch;
  while ((rcvMatch = receiverRegex.exec(xml)) !== null) {
    manifest.receivers.push(rcvMatch[1]);
  }

  const providerRegex = /<provider\s+android:name="([^"]+)"/g;
  let provMatch;
  while ((provMatch = providerRegex.exec(xml)) !== null) {
    manifest.providers.push(provMatch[1]);
  }

  const metaRegex = /<meta-data\s+android:name="([^"]+)"\s+android:value="([^"]+)"/g;
  let metaMatch;
  while ((metaMatch = metaRegex.exec(xml)) !== null) {
    manifest.metaData[metaMatch[1]] = metaMatch[2];
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifest(manifest: ManifestInspection, mode: BuildMode): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.packageName) {
    errors.push('Missing package name');
  } else if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(manifest.packageName)) {
    errors.push(`Invalid package name: ${manifest.packageName}`);
  }

  if (manifest.minSdkVersion < 24) {
    errors.push(`minSdkVersion ${manifest.minSdkVersion} below minimum 24`);
  }
  if (manifest.targetSdkVersion < 33) {
    warnings.push(`targetSdkVersion ${manifest.targetSdkVersion} below recommended 33`);
  }

  if (mode === 'release') {
    if (manifest.debuggable) {
      errors.push('BLOCKER: android:debuggable=true in release build');
    }
  }

  const launcherActivities = manifest.activities.filter((a) => a.isLauncher);
  if (launcherActivities.length === 0) {
    errors.push('No launcher activity found');
  } else if (launcherActivities.length > 1) {
    warnings.push(`Multiple launcher activities: ${launcherActivities.map((a) => a.name).join(', ')}`);
  }

  for (const activity of manifest.activities) {
    if (activity.exported && !activity.isLauncher) {
      warnings.push(`Activity ${activity.name} is exported but not a launcher`);
    }
  }

  if (!manifest.versionName) {
    errors.push('Missing versionName');
  }
  if (manifest.versionCode < 1) {
    errors.push('versionCode must be >= 1');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Signing verification
// ---------------------------------------------------------------------------

export function parseSigningInfo(apksignerOutput: string): SigningVerification {
  const result = createSigningVerification();

  if (apksignerOutput.includes('DOES NOT VERIFY') || apksignerOutput.includes('ERROR')) {
    return result;
  }

  result.signed = apksignerOutput.includes('Verified using') ||
    apksignerOutput.includes('v1 scheme') ||
    apksignerOutput.includes('v2 scheme');

  const schemeChecks: [SigningScheme, RegExp][] = [
    ['v1', /v1 scheme.*:\s*true/i],
    ['v2', /v2 scheme.*:\s*true/i],
    ['v3', /v3 scheme.*:\s*true/i],
    ['v4', /v4 scheme.*:\s*true/i],
  ];
  for (const [scheme, regex] of schemeChecks) {
    if (regex.test(apksignerOutput)) result.schemes.push(scheme);
  }

  const algMatch = apksignerOutput.match(/Algorithm:\s*(\S+)/);
  if (algMatch) result.keyAlgorithm = algMatch[1];

  const sizeMatch = apksignerOutput.match(/Key Size:\s*(\d+)/);
  if (sizeMatch) result.keySize = parseInt(sizeMatch[1], 10);

  const issuerMatch = apksignerOutput.match(/Issuer:\s*(.+)/);
  if (issuerMatch) result.issuer = issuerMatch[1].trim();

  const subjectMatch = apksignerOutput.match(/Subject:\s*(.+)/);
  if (subjectMatch) result.subject = subjectMatch[1].trim();

  const sha256Match = apksignerOutput.match(/SHA-256:\s*([A-Fa-f0-9:]+)/);
  if (sha256Match) result.sha256Fingerprint = sha256Match[1];

  result.debugSigned = apksignerOutput.includes('CN=Android Debug') ||
    apksignerOutput.includes('debug.keystore') ||
    (result.subject !== null && result.subject.includes('Android Debug'));

  return result;
}

export function validateSigning(signing: SigningVerification, mode: BuildMode): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!signing.signed) {
    errors.push('Artifact is not signed');
    return { valid: false, errors };
  }

  if (signing.schemes.length === 0) {
    errors.push('No signing scheme detected');
  }

  if (mode === 'release') {
    if (signing.debugSigned) {
      errors.push('BLOCKER: Release artifact signed with debug keystore');
    }
    if (signing.keySize !== null && signing.keySize < 2048) {
      errors.push(`Key size ${signing.keySize} below minimum 2048 bits`);
    }
    if (!signing.schemes.includes('v2')) {
      errors.push('Release artifact must use v2+ signing scheme');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Contamination scan
// ---------------------------------------------------------------------------

export function scanForContamination(content: string, path: string): ContaminationFinding[] {
  const findings: ContaminationFinding[] = [];
  for (const { type, patterns } of CONTAMINATION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        findings.push({
          type,
          path,
          detail: `Found ${type} pattern in ${path}`,
          severity: type === 'simulator_config' || type === 'mock_endpoint' || type === 'permission_override'
            ? 'blocker'
            : 'high',
        });
        break;
      }
    }
  }
  return findings;
}

export function scanArtifactContents(
  files: { path: string; content: string }[],
): ContaminationFinding[] {
  const findings: ContaminationFinding[] = [];
  for (const file of files) {
    findings.push(...scanForContamination(file.content, file.path));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Extension-backed build verification
// ---------------------------------------------------------------------------

export interface ExtensionBuildCheck {
  extensionId: string;
  buildsSuccessfully: boolean;
  artifactClean: boolean;
  contaminationFindings: ContaminationFinding[];
}

export function validateExtensionBuild(
  extensionId: string,
  buildSuccess: boolean,
  artifactFiles: { path: string; content: string }[],
): ExtensionBuildCheck {
  const findings = scanArtifactContents(artifactFiles);
  return {
    extensionId,
    buildsSuccessfully: buildSuccess,
    artifactClean: findings.length === 0,
    contaminationFindings: findings,
  };
}

// ---------------------------------------------------------------------------
// Artifact metadata extraction
// ---------------------------------------------------------------------------

export function createBuildArtifact(
  path: string,
  format: ArtifactFormat,
  mode: BuildMode,
  sizeBytes: number,
  manifest: ManifestInspection,
): BuildArtifact {
  return {
    path,
    format,
    mode,
    sizeBytes,
    applicationId: manifest.packageName,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    minSdk: manifest.minSdkVersion,
    targetSdk: manifest.targetSdkVersion,
    compileSdk: manifest.targetSdkVersion,
    timestamp: Date.now(),
  };
}
