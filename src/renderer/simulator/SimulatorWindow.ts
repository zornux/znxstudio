import './simulator.css';
import { SimulatorSession } from './SimulatorSession';

const root = document.getElementById('zsim-floating-root')!;
const session = new SimulatorSession();
let zoom = 0;
let shell: HTMLElement;
let stage: HTMLElement;

function button(label: string, title: string, action: () => void): HTMLButtonElement {
  const el = document.createElement('button'); el.className = 'zsim-toolbar-btn'; el.textContent = label; el.title = title; el.setAttribute('aria-label', title); el.onclick = action; return el;
}
function layout(): void {
  if (!shell || !stage) return;
  const env = session.getRuntime().getEnvironment(); const landscape = env.orientation === 'landscape';
  const width = (landscape ? env.deviceProfile.height : env.deviceProfile.width) + 28;
  const height = (landscape ? env.deviceProfile.width : env.deviceProfile.height) + 100;
  shell.dataset.deviceClass=env.deviceProfile.deviceClass; shell.dataset.orientation=env.orientation;
  const host = stage.parentElement!.getBoundingClientRect();
  const scale = Math.max(.25, Math.min(2, zoom || Math.min((host.width - 32) / width, (host.height - 32) / height, 1)));
  shell.style.transform = `scale(${scale})`; stage.style.width = `${width * scale}px`; stage.style.height = `${height * scale}px`;
  const label = root.querySelector('.zsim-zoom-label'); if (label) label.textContent = zoom ? `${Math.round(scale * 100)}%` : 'Fit';
}
function createChrome(): void {
  root.innerHTML = ''; const toolbar = document.createElement('div'); toolbar.className = 'zsim-toolbar zsim-floating-toolbar';
  const title = document.createElement('div'); title.className = 'zsim-floating-title'; title.textContent = 'Android Device'; toolbar.append(title);
  toolbar.append(button('↻', 'Restart', () => void session.reload(currentApp!)), button('◐', 'Toggle light/dark theme', () => { const rt=session.getRuntime(); rt.setTheme(rt.getEnvironment().theme==='dark'?'light':'dark'); }), button('⟳', 'Rotate device', () => { const rt=session.getRuntime(); rt.setOrientation(rt.getEnvironment().orientation==='portrait'?'landscape':'portrait'); layout(); }), button('−', 'Zoom out', () => { zoom=Math.max(.25,(zoom||.7)-.1); layout(); }));
  const fit=button('Fit','Fit to window',()=>{zoom=0;layout();}); fit.classList.add('zsim-zoom-label'); toolbar.append(fit, button('+','Zoom in',()=>{zoom=Math.min(2,(zoom||.7)+.1);layout();}), button('⬒','Dock back into ZnxStudio',()=>void window.znxstudio.simulator.dockWindow()));
  const host=document.createElement('main'); host.className='zsim-device-container zsim-floating-host'; stage=document.createElement('div'); stage.className='zsim-device-stage'; shell=document.createElement('div'); shell.className='zsim-device-shell';
  const earpiece=document.createElement('div');earpiece.className='zsim-device-earpiece';const camera=document.createElement('div');camera.className='zsim-device-camera';const sensor=document.createElement('div');sensor.className='zsim-device-sensor';const display=document.createElement('div');display.className='zsim-device-display';const status=document.createElement('div');status.className='zsim-system-status';status.innerHTML='<span>1:07</span><span class="zsim-system-icons">▴ 4G&nbsp; ◔&nbsp; ▰</span>';const navigation=document.createElement('div');navigation.className='zsim-system-navigation';navigation.innerHTML='<button aria-label="Back">◀</button><button aria-label="Home" class="zsim-system-home"></button><button aria-label="Recent apps">■</button>';display.append(status,session.getRenderer().element,navigation); shell.append(earpiece,camera,sensor,display);stage.append(shell);host.append(stage);root.append(toolbar,host);new ResizeObserver(layout).observe(host);layout();
}
let currentApp: Awaited<ReturnType<typeof window.znxstudio.simulator.windowPayload>> = null;
async function load(app?: NonNullable<typeof currentApp>): Promise<void> { const next = app ?? await window.znxstudio.simulator.windowPayload(); if (!next) return; currentApp=next; await session.start(next); createChrome(); }
window.znxstudio.simulator.onWindowClosed(() => undefined);
void load();
