/**
 * Component registry for the Android visual designer. Every widget that can be
 * dragged onto the design surface is described here: its properties, events,
 * default values, and how it maps to Zornux mobile syntax.
 */

// ---------------------------------------------------------------------------
// Property descriptors
// ---------------------------------------------------------------------------

export type PropertyType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'color'
  | 'spacing'
  | 'alignment';

export interface PropertyDescriptor {
  key: string;
  label: string;
  type: PropertyType;
  defaultValue: string | number | boolean;
  /** For 'enum' type only. */
  options?: string[];
  /** Optional numeric editor constraints. */
  min?: number;
  max?: number;
  step?: number;
  /** Zornux syntax attribute name (may differ from the UI label). */
  zxAttr: string;
  group: 'content' | 'layout' | 'style' | 'behavior';
}

// ---------------------------------------------------------------------------
// Event descriptors
// ---------------------------------------------------------------------------

export interface EventDescriptor {
  key: string;
  label: string;
  /** Zornux syntax keyword (e.g. 'tapped', 'changed', 'toggled'). */
  zxKeyword: string;
  /** Whether the handler receives a value parameter. */
  hasValue: boolean;
}

// ---------------------------------------------------------------------------
// Component descriptor
// ---------------------------------------------------------------------------

export type ComponentCategory =
  | 'basic'
  | 'input'
  | 'layout'
  | 'navigation'
  | 'feedback'
  | 'data'
  | 'media';

export interface ComponentDescriptor {
  kind: string;
  label: string;
  category: ComponentCategory;
  icon: string;
  /** The Zornux keyword that opens this component's block. */
  zxKeyword: string;
  /** Whether this component can contain children. */
  isContainer: boolean;
  /** Allowed child component kinds (empty = any). */
  allowedChildren: string[];
  properties: PropertyDescriptor[];
  events: EventDescriptor[];
  /** Preview text shown in the toolbox. */
  previewHint: string;
}

// ---------------------------------------------------------------------------
// Shared property sets
// ---------------------------------------------------------------------------

const SPACING_PROPS: PropertyDescriptor[] = [
  { key: 'padding', label: 'Padding', type: 'number', defaultValue: 0, zxAttr: 'padding', group: 'layout' },
  { key: 'marginTop', label: 'Margin Top', type: 'number', defaultValue: 0, zxAttr: 'margin_top', group: 'layout' },
  { key: 'marginBottom', label: 'Margin Bottom', type: 'number', defaultValue: 0, zxAttr: 'margin_bottom', group: 'layout' },
  { key: 'marginStart', label: 'Margin Start', type: 'number', defaultValue: 0, zxAttr: 'margin_start', group: 'layout' },
  { key: 'marginEnd', label: 'Margin End', type: 'number', defaultValue: 0, zxAttr: 'margin_end', group: 'layout' },
];

const VISIBILITY_PROP: PropertyDescriptor = {
  key: 'visible', label: 'Visible', type: 'boolean', defaultValue: true, zxAttr: 'visible', group: 'behavior',
};

const SIZE_PROPS: PropertyDescriptor[] = [
  { key: 'width', label: 'Width', type: 'text', defaultValue: '', zxAttr: 'width', group: 'layout' },
  { key: 'height', label: 'Height', type: 'text', defaultValue: '', zxAttr: 'height', group: 'layout' },
];

const ALIGNMENT_PROP: PropertyDescriptor = {
  key: 'alignment', label: 'Alignment', type: 'enum', defaultValue: 'start',
  options: ['start', 'center', 'end', 'stretch'], zxAttr: 'alignment', group: 'layout',
};

const POSITION_PROPS: PropertyDescriptor[] = [
  { key: 'positionMode', label: 'Position', type: 'enum', defaultValue: 'flow', options: ['flow', 'freeform'], zxAttr: 'position', group: 'layout' },
  { key: 'x', label: 'X', type: 'number', defaultValue: 0, zxAttr: 'x', group: 'layout' },
  { key: 'y', label: 'Y', type: 'number', defaultValue: 0, zxAttr: 'y', group: 'layout' },
];

const PROFESSIONAL_PROPS: PropertyDescriptor[] = [
  { key: 'backgroundColor', label: 'Background Color', type: 'color', defaultValue: '', zxAttr: 'background_color', group: 'style' },
  { key: 'borderColor', label: 'Border Color', type: 'color', defaultValue: '', zxAttr: 'border_color', group: 'style' },
  { key: 'borderWidth', label: 'Border Width', type: 'number', defaultValue: 0, min: 0, step: 1, zxAttr: 'border_width', group: 'style' },
  { key: 'cornerRadius', label: 'Corner Radius', type: 'number', defaultValue: 0, min: 0, step: 1, zxAttr: 'corner_radius', group: 'style' },
  { key: 'elevation', label: 'Elevation', type: 'number', defaultValue: 0, min: 0, step: 1, zxAttr: 'elevation', group: 'style' },
  { key: 'opacity', label: 'Opacity', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.05, zxAttr: 'opacity', group: 'style' },
  { key: 'rotation', label: 'Rotation', type: 'number', defaultValue: 0, zxAttr: 'rotation', group: 'style' },
  { key: 'zIndex', label: 'Z Index', type: 'number', defaultValue: 0, zxAttr: 'z_index', group: 'layout' },
  { key: 'aspectRatio', label: 'Aspect Ratio', type: 'text', defaultValue: '', zxAttr: 'aspect_ratio', group: 'layout' },
  { key: 'contentDescription', label: 'Content Description', type: 'text', defaultValue: '', zxAttr: 'content_description', group: 'behavior' },
  { key: 'testTag', label: 'Test Tag', type: 'text', defaultValue: '', zxAttr: 'test_tag', group: 'behavior' },
  { key: 'clickable', label: 'Clickable', type: 'boolean', defaultValue: false, zxAttr: 'clickable', group: 'behavior' },
  { key: 'focusable', label: 'Focusable', type: 'boolean', defaultValue: false, zxAttr: 'focusable', group: 'behavior' },
  { key: 'semanticRole', label: 'Accessibility Role', type: 'enum', defaultValue: 'auto', options: ['auto', 'button', 'checkbox', 'switch', 'image', 'text', 'tab'], zxAttr: 'semantic_role', group: 'behavior' },
];

const ENHANCED_PROPERTIES: Record<string, PropertyDescriptor[]> = {
  text: [
    { key: 'fontSize', label: 'Font Size', type: 'number', defaultValue: 14, zxAttr: 'font_size', group: 'style' },
    { key: 'lineHeight', label: 'Line Height', type: 'number', defaultValue: 0, zxAttr: 'line_height', group: 'style' },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'number', defaultValue: 0, zxAttr: 'letter_spacing', group: 'style' },
    { key: 'maxLines', label: 'Max Lines', type: 'number', defaultValue: 0, zxAttr: 'max_lines', group: 'behavior' },
    { key: 'textAlign', label: 'Text Align', type: 'enum', defaultValue: 'start', options: ['start', 'center', 'end', 'justify'], zxAttr: 'text_align', group: 'style' },
  ],
  button: [
    { key: 'containerColor', label: 'Container Color', type: 'color', defaultValue: '#6750A4', zxAttr: 'container_color', group: 'style' },
    { key: 'contentColor', label: 'Content Color', type: 'color', defaultValue: '#FFFFFF', zxAttr: 'content_color', group: 'style' },
    { key: 'iconName', label: 'Leading Icon', type: 'text', defaultValue: '', zxAttr: 'icon', group: 'content' },
    { key: 'loading', label: 'Loading', type: 'boolean', defaultValue: false, zxAttr: 'loading', group: 'behavior' },
  ],
  checkbox: [
    { key: 'checked', label: 'Checked', type: 'boolean', defaultValue: false, zxAttr: 'checked', group: 'behavior' },
    { key: 'checkColor', label: 'Check Color', type: 'color', defaultValue: '#6750A4', zxAttr: 'check_color', group: 'style' },
    { key: 'labelColor', label: 'Label Color', type: 'color', defaultValue: '#212121', zxAttr: 'label_color', group: 'style' },
  ],
  switch: [
    { key: 'checked', label: 'Checked', type: 'boolean', defaultValue: false, zxAttr: 'checked', group: 'behavior' },
    { key: 'trackColor', label: 'Track Color', type: 'color', defaultValue: '#79747E', zxAttr: 'track_color', group: 'style' },
    { key: 'thumbColor', label: 'Thumb Color', type: 'color', defaultValue: '#FFFFFF', zxAttr: 'thumb_color', group: 'style' },
  ],
  input: [
    { key: 'label', label: 'Label', type: 'text', defaultValue: '', zxAttr: 'label', group: 'content' },
    { key: 'supportingText', label: 'Supporting Text', type: 'text', defaultValue: '', zxAttr: 'supporting_text', group: 'content' },
    { key: 'leadingIcon', label: 'Leading Icon', type: 'text', defaultValue: '', zxAttr: 'leading_icon', group: 'content' },
    { key: 'trailingIcon', label: 'Trailing Icon', type: 'text', defaultValue: '', zxAttr: 'trailing_icon', group: 'content' },
    { key: 'isError', label: 'Error State', type: 'boolean', defaultValue: false, zxAttr: 'is_error', group: 'behavior' },
    { key: 'readOnly', label: 'Read Only', type: 'boolean', defaultValue: false, zxAttr: 'read_only', group: 'behavior' },
    { key: 'required', label: 'Required', type: 'boolean', defaultValue: false, zxAttr: 'required', group: 'behavior' },
  ],
  image: [
    { key: 'tintColor', label: 'Tint Color', type: 'color', defaultValue: '', zxAttr: 'tint_color', group: 'style' },
  ],
  icon: [
    { key: 'tintColor', label: 'Tint Color', type: 'color', defaultValue: '#6750A4', zxAttr: 'tint_color', group: 'style' },
  ],
  slider: [
    { key: 'value', label: 'Preview Value', type: 'number', defaultValue: 50, zxAttr: 'value', group: 'behavior' },
    { key: 'activeColor', label: 'Active Color', type: 'color', defaultValue: '#6750A4', zxAttr: 'active_color', group: 'style' },
    { key: 'showValue', label: 'Show Value', type: 'boolean', defaultValue: false, zxAttr: 'show_value', group: 'behavior' },
  ],
  progress: [
    { key: 'indicatorColor', label: 'Indicator Color', type: 'color', defaultValue: '#6750A4', zxAttr: 'indicator_color', group: 'style' },
    { key: 'trackColor', label: 'Track Color', type: 'color', defaultValue: '#E6E0E9', zxAttr: 'track_color', group: 'style' },
  ],
  card: [
    { key: 'contentColor', label: 'Content Color', type: 'color', defaultValue: '#212121', zxAttr: 'content_color', group: 'style' },
  ],
};

// ---------------------------------------------------------------------------
// Component catalog
// ---------------------------------------------------------------------------

export const COMPONENT_CATALOG: readonly ComponentDescriptor[] = [
  // ---- Basic ----
  {
    kind: 'text',
    label: 'Text',
    category: 'basic',
    icon: 'T',
    zxKeyword: 'text',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'content', label: 'Text', type: 'text', defaultValue: 'Text', zxAttr: '', group: 'content' },
      { key: 'size', label: 'Size', type: 'enum', defaultValue: 'body', options: ['heading', 'subheading', 'body', 'caption', 'overline'], zxAttr: 'size', group: 'style' },
      { key: 'weight', label: 'Weight', type: 'enum', defaultValue: 'normal', options: ['normal', 'bold', 'light'], zxAttr: 'weight', group: 'style' },
      { key: 'color', label: 'Color', type: 'enum', defaultValue: 'primary', options: ['primary', 'secondary', 'accent', 'error', 'success'], zxAttr: 'color', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Static or dynamic text label',
  },
  {
    kind: 'button',
    label: 'Button',
    category: 'basic',
    icon: '▢',
    zxKeyword: 'button',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'label', label: 'Label', type: 'text', defaultValue: 'Button', zxAttr: '', group: 'content' },
      { key: 'style', label: 'Style', type: 'enum', defaultValue: 'primary', options: ['primary', 'secondary', 'outline', 'text'], zxAttr: 'style', group: 'style' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true, zxAttr: 'enabled', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SPACING_PROPS,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
      { key: 'longPressed', label: 'Long Pressed', zxKeyword: 'long_pressed', hasValue: false },
    ],
    previewHint: 'Tappable action button',
  },
  {
    kind: 'image',
    label: 'Image',
    category: 'media',
    icon: '🖼',
    zxKeyword: 'image',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'source', label: 'Source', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'alt', label: 'Description', type: 'text', defaultValue: '', zxAttr: 'alt', group: 'content' },
      { key: 'fit', label: 'Fit', type: 'enum', defaultValue: 'contain', options: ['contain', 'cover', 'fill', 'none'], zxAttr: 'fit', group: 'style' },
      ...SIZE_PROPS,
      { key: 'cornerRadius', label: 'Corner Radius', type: 'number', defaultValue: 0, zxAttr: 'corner_radius', group: 'style' },
      ALIGNMENT_PROP,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Displays an image from a file or URL',
  },
  {
    kind: 'icon',
    label: 'Icon',
    category: 'basic',
    icon: '★',
    zxKeyword: 'icon',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'name', label: 'Icon Name', type: 'text', defaultValue: 'star', zxAttr: '', group: 'content' },
      { key: 'iconSize', label: 'Size', type: 'number', defaultValue: 24, zxAttr: 'size', group: 'style' },
      { key: 'color', label: 'Color', type: 'enum', defaultValue: 'primary', options: ['primary', 'secondary', 'accent', 'error', 'success'], zxAttr: 'color', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Material design icon',
  },

  // ---- Input ----
  {
    kind: 'input',
    label: 'Text Input',
    category: 'input',
    icon: '⌨',
    zxKeyword: 'input',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'placeholder', label: 'Placeholder', type: 'text', defaultValue: 'Enter text', zxAttr: 'placeholder', group: 'content' },
      { key: 'inputType', label: 'Input Type', type: 'enum', defaultValue: 'text', options: ['text', 'number', 'email', 'password', 'phone', 'multiline'], zxAttr: 'type', group: 'behavior' },
      { key: 'maxLength', label: 'Max Length', type: 'number', defaultValue: 0, zxAttr: 'max_length', group: 'behavior' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true, zxAttr: 'enabled', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'changed', label: 'Changed', zxKeyword: 'changed', hasValue: true },
      { key: 'submitted', label: 'Submitted', zxKeyword: 'submitted', hasValue: true },
    ],
    previewHint: 'Editable text field',
  },
  {
    kind: 'checkbox',
    label: 'Checkbox',
    category: 'input',
    icon: '☑',
    zxKeyword: 'checkbox',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'label', label: 'Label', type: 'text', defaultValue: 'Check me', zxAttr: 'label', group: 'content' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true, zxAttr: 'enabled', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'toggled', label: 'Toggled', zxKeyword: 'toggled', hasValue: true },
    ],
    previewHint: 'Boolean toggle with label',
  },
  {
    kind: 'switch',
    label: 'Switch',
    category: 'input',
    icon: '⊙',
    zxKeyword: 'switch',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'label', label: 'Label', type: 'text', defaultValue: 'Toggle', zxAttr: 'label', group: 'content' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true, zxAttr: 'enabled', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'toggled', label: 'Toggled', zxKeyword: 'toggled', hasValue: true },
    ],
    previewHint: 'On/off toggle switch',
  },
  {
    kind: 'slider',
    label: 'Slider',
    category: 'input',
    icon: '─●─',
    zxKeyword: 'slider',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'min', label: 'Min', type: 'number', defaultValue: 0, zxAttr: 'min', group: 'behavior' },
      { key: 'max', label: 'Max', type: 'number', defaultValue: 100, zxAttr: 'max', group: 'behavior' },
      { key: 'step', label: 'Step', type: 'number', defaultValue: 1, zxAttr: 'step', group: 'behavior' },
      { key: 'label', label: 'Label', type: 'text', defaultValue: '', zxAttr: 'label', group: 'content' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'changed', label: 'Changed', zxKeyword: 'changed', hasValue: true },
    ],
    previewHint: 'Continuous or stepped range slider',
  },
  {
    kind: 'dropdown',
    label: 'Dropdown',
    category: 'input',
    icon: '▾',
    zxKeyword: 'dropdown',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'label', label: 'Label', type: 'text', defaultValue: 'Select', zxAttr: 'label', group: 'content' },
      { key: 'items', label: 'Items', type: 'text', defaultValue: 'Option 1, Option 2, Option 3', zxAttr: 'items', group: 'content' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'changed', label: 'Selected', zxKeyword: 'changed', hasValue: true },
    ],
    previewHint: 'Single-selection dropdown menu',
  },

  // ---- Layout ----
  {
    kind: 'column',
    label: 'Column',
    category: 'layout',
    icon: '⬒',
    zxKeyword: 'column',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'spacing', label: 'Spacing', type: 'number', defaultValue: 0, zxAttr: 'spacing', group: 'layout' },
      { key: 'crossAlignment', label: 'Cross Alignment', type: 'enum', defaultValue: 'stretch', options: ['start', 'center', 'end', 'stretch'], zxAttr: 'cross_alignment', group: 'layout' },
      { key: 'mainAlignment', label: 'Main Alignment', type: 'enum', defaultValue: 'start', options: ['start', 'center', 'end', 'space_between', 'space_around'], zxAttr: 'main_alignment', group: 'layout' },
      { key: 'scrollable', label: 'Scrollable', type: 'boolean', defaultValue: false, zxAttr: 'scrollable', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Vertical layout container',
  },
  {
    kind: 'row',
    label: 'Row',
    category: 'layout',
    icon: '⬓',
    zxKeyword: 'row',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'spacing', label: 'Spacing', type: 'number', defaultValue: 0, zxAttr: 'spacing', group: 'layout' },
      { key: 'crossAlignment', label: 'Cross Alignment', type: 'enum', defaultValue: 'center', options: ['start', 'center', 'end', 'stretch'], zxAttr: 'cross_alignment', group: 'layout' },
      { key: 'mainAlignment', label: 'Main Alignment', type: 'enum', defaultValue: 'start', options: ['start', 'center', 'end', 'space_between', 'space_around'], zxAttr: 'main_alignment', group: 'layout' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Horizontal layout container',
  },
  {
    kind: 'stack',
    label: 'Stack',
    category: 'layout',
    icon: '⊡',
    zxKeyword: 'stack',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'contentAlignment', label: 'Alignment', type: 'enum', defaultValue: 'center', options: ['top_start', 'top_center', 'top_end', 'center_start', 'center', 'center_end', 'bottom_start', 'bottom_center', 'bottom_end'], zxAttr: 'content_alignment', group: 'layout' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Overlapping layer container',
  },
  {
    kind: 'grid',
    label: 'Grid',
    category: 'layout',
    icon: '⊞',
    zxKeyword: 'grid',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'columns', label: 'Columns', type: 'number', defaultValue: 2, zxAttr: 'columns', group: 'layout' },
      { key: 'spacing', label: 'Spacing', type: 'number', defaultValue: 8, zxAttr: 'spacing', group: 'layout' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Multi-column grid layout',
  },
  {
    kind: 'spacer',
    label: 'Spacer',
    category: 'layout',
    icon: '↕',
    zxKeyword: 'spacer',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'size', label: 'Size', type: 'number', defaultValue: 16, zxAttr: 'size', group: 'layout' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
    ],
    events: [],
    previewHint: 'Flexible empty space',
  },
  {
    kind: 'divider',
    label: 'Divider',
    category: 'layout',
    icon: '—',
    zxKeyword: 'divider',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'color', label: 'Color', type: 'enum', defaultValue: 'secondary', options: ['primary', 'secondary', 'accent'], zxAttr: 'color', group: 'style' },
      { key: 'thickness', label: 'Thickness', type: 'number', defaultValue: 1, zxAttr: 'thickness', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
    ],
    events: [],
    previewHint: 'Horizontal or vertical line separator',
  },
  {
    kind: 'scrollview',
    label: 'Scroll View',
    category: 'layout',
    icon: '⤓',
    zxKeyword: 'scroll',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'direction', label: 'Direction', type: 'enum', defaultValue: 'vertical', options: ['vertical', 'horizontal'], zxAttr: 'direction', group: 'layout' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Scrollable content area',
  },

  // ---- Navigation ----
  {
    kind: 'navbar',
    label: 'Top App Bar',
    category: 'navigation',
    icon: '⊤',
    zxKeyword: 'top_bar',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'title', label: 'Title', type: 'text', defaultValue: 'Screen Title', zxAttr: 'title', group: 'content' },
      { key: 'showBack', label: 'Show Back', type: 'boolean', defaultValue: false, zxAttr: 'show_back', group: 'behavior' },
      { key: 'barStyle', label: 'Style', type: 'enum', defaultValue: 'standard', options: ['standard', 'large', 'medium'], zxAttr: 'bar_style', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'backTapped', label: 'Back Tapped', zxKeyword: 'back_tapped', hasValue: false },
    ],
    previewHint: 'App bar with title and navigation',
  },
  {
    kind: 'bottomnav',
    label: 'Bottom Navigation',
    category: 'navigation',
    icon: '⊥',
    zxKeyword: 'bottom_nav',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'items', label: 'Items', type: 'text', defaultValue: 'Home, Search, Profile', zxAttr: 'items', group: 'content' },
      { key: 'icons', label: 'Icons', type: 'text', defaultValue: 'home, search, person', zxAttr: 'icons', group: 'content' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'changed', label: 'Tab Changed', zxKeyword: 'changed', hasValue: true },
    ],
    previewHint: 'Bottom tab navigation bar',
  },
  {
    kind: 'tabs',
    label: 'Tabs',
    category: 'navigation',
    icon: '⊟',
    zxKeyword: 'tabs',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'items', label: 'Tab Labels', type: 'text', defaultValue: 'Tab 1, Tab 2, Tab 3', zxAttr: 'items', group: 'content' },
      { key: 'scrollable', label: 'Scrollable', type: 'boolean', defaultValue: false, zxAttr: 'scrollable', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'changed', label: 'Tab Changed', zxKeyword: 'changed', hasValue: true },
    ],
    previewHint: 'Horizontal tab strip',
  },
  {
    kind: 'fab',
    label: 'FAB',
    category: 'navigation',
    icon: '⊕',
    zxKeyword: 'fab',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'iconName', label: 'Icon', type: 'text', defaultValue: 'add', zxAttr: 'icon', group: 'content' },
      { key: 'label', label: 'Label', type: 'text', defaultValue: '', zxAttr: 'label', group: 'content' },
      { key: 'fabSize', label: 'Size', type: 'enum', defaultValue: 'regular', options: ['small', 'regular', 'large'], zxAttr: 'fab_size', group: 'style' },
      ALIGNMENT_PROP,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Floating action button',
  },

  // ---- Data ----
  {
    kind: 'card',
    label: 'Card',
    category: 'data',
    icon: '▭',
    zxKeyword: 'card',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'elevation', label: 'Elevation', type: 'number', defaultValue: 2, zxAttr: 'elevation', group: 'style' },
      { key: 'cornerRadius', label: 'Corner Radius', type: 'number', defaultValue: 12, zxAttr: 'corner_radius', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Elevated surface container',
  },
  {
    kind: 'list',
    label: 'List',
    category: 'data',
    icon: '≡',
    zxKeyword: 'list',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Data Source', type: 'text', defaultValue: 'items', zxAttr: '', group: 'content' },
      { key: 'separator', label: 'Show Separators', type: 'boolean', defaultValue: true, zxAttr: 'separator', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Item Tapped', zxKeyword: 'item_tapped', hasValue: true },
    ],
    previewHint: 'Repeating list of items',
  },
  {
    kind: 'chip',
    label: 'Chip',
    category: 'data',
    icon: '◖',
    zxKeyword: 'chip',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'label', label: 'Label', type: 'text', defaultValue: 'Chip', zxAttr: '', group: 'content' },
      { key: 'chipStyle', label: 'Style', type: 'enum', defaultValue: 'filled', options: ['filled', 'outline', 'elevated'], zxAttr: 'chip_style', group: 'style' },
      { key: 'selected', label: 'Selected', type: 'boolean', defaultValue: false, zxAttr: 'selected', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'tapped', label: 'Tapped', zxKeyword: 'tapped', hasValue: false },
    ],
    previewHint: 'Compact actionable element',
  },
  {
    kind: 'badge',
    label: 'Badge',
    category: 'data',
    icon: '●',
    zxKeyword: 'badge',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'content', label: 'Content', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'color', label: 'Color', type: 'enum', defaultValue: 'error', options: ['primary', 'secondary', 'accent', 'error', 'success'], zxAttr: 'color', group: 'style' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Notification count indicator',
  },

  // ---- Feedback ----
  {
    kind: 'progress',
    label: 'Progress Bar',
    category: 'feedback',
    icon: '▓',
    zxKeyword: 'progress',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'binding', label: 'Bind to State', type: 'text', defaultValue: '', zxAttr: '', group: 'content' },
      { key: 'progressStyle', label: 'Style', type: 'enum', defaultValue: 'linear', options: ['linear', 'circular'], zxAttr: 'progress_style', group: 'style' },
      { key: 'indeterminate', label: 'Indeterminate', type: 'boolean', defaultValue: false, zxAttr: 'indeterminate', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      ...SPACING_PROPS,
      VISIBILITY_PROP,
    ],
    events: [],
    previewHint: 'Loading or progress indicator',
  },
  {
    kind: 'snackbar',
    label: 'Snackbar',
    category: 'feedback',
    icon: '▬',
    zxKeyword: 'snackbar',
    isContainer: false,
    allowedChildren: [],
    properties: [
      { key: 'message', label: 'Message', type: 'text', defaultValue: 'Action completed', zxAttr: 'message', group: 'content' },
      { key: 'action', label: 'Action Label', type: 'text', defaultValue: '', zxAttr: 'action', group: 'content' },
      { key: 'duration', label: 'Duration', type: 'enum', defaultValue: 'short', options: ['short', 'long', 'indefinite'], zxAttr: 'duration', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'actionTapped', label: 'Action Tapped', zxKeyword: 'action_tapped', hasValue: false },
      { key: 'dismissed', label: 'Dismissed', zxKeyword: 'dismissed', hasValue: false },
    ],
    previewHint: 'Temporary bottom message',
  },
  {
    kind: 'dialog',
    label: 'Dialog',
    category: 'feedback',
    icon: '◻',
    zxKeyword: 'dialog',
    isContainer: true,
    allowedChildren: [],
    properties: [
      { key: 'title', label: 'Title', type: 'text', defaultValue: 'Dialog', zxAttr: 'title', group: 'content' },
      { key: 'confirmLabel', label: 'Confirm Label', type: 'text', defaultValue: 'OK', zxAttr: 'confirm', group: 'content' },
      { key: 'cancelLabel', label: 'Cancel Label', type: 'text', defaultValue: 'Cancel', zxAttr: 'cancel', group: 'content' },
      { key: 'dismissible', label: 'Dismissible', type: 'boolean', defaultValue: true, zxAttr: 'dismissible', group: 'behavior' },
      ALIGNMENT_PROP,
      ...SIZE_PROPS,
      VISIBILITY_PROP,
    ],
    events: [
      { key: 'confirmed', label: 'Confirmed', zxKeyword: 'confirmed', hasValue: false },
      { key: 'cancelled', label: 'Cancelled', zxKeyword: 'cancelled', hasValue: false },
    ],
    previewHint: 'Modal dialog overlay',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const catalogByKind = new Map<string, ComponentDescriptor>();
for (const desc of COMPONENT_CATALOG) {
  for (const property of desc.properties) {
    if (property.key === 'color') {
      property.type = 'color';
      property.options = undefined;
    }
  }
  // Positioning is a universal canvas concern. Keeping it centralized avoids
  // components quietly missing freeform placement as the catalog grows.
  desc.properties.push(...POSITION_PROPS.map((property) => ({ ...property })));
  for (const property of [...SIZE_PROPS, ALIGNMENT_PROP, ...SPACING_PROPS]) {
    if (!desc.properties.some((existing) => existing.key === property.key)) desc.properties.push({ ...property });
  }
  for (const property of [...PROFESSIONAL_PROPS, ...(ENHANCED_PROPERTIES[desc.kind] ?? [])]) {
    if (!desc.properties.some((existing) => existing.key === property.key)) {
      desc.properties.push({
        ...property,
        defaultValue: property.key === 'clickable' && !['spacer', 'divider'].includes(desc.kind) ? true : property.defaultValue,
      });
    }
  }
  if (!['spacer', 'divider'].includes(desc.kind) && !desc.events.some((event) => event.key === 'tapped')) {
    desc.events.push({ key: 'tapped', label: 'Clicked', zxKeyword: 'tapped', hasValue: false });
  }
  catalogByKind.set(desc.kind, desc);
}

export function getDescriptor(kind: string): ComponentDescriptor | undefined {
  return catalogByKind.get(kind);
}

export function descriptorsByCategory(category: ComponentCategory): ComponentDescriptor[] {
  return COMPONENT_CATALOG.filter((d) => d.category === category);
}

export const CATEGORY_ORDER: ComponentCategory[] = [
  'basic', 'input', 'layout', 'navigation', 'data', 'feedback', 'media',
];

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  basic: 'Basic',
  input: 'Input',
  layout: 'Layout',
  navigation: 'Navigation',
  data: 'Data Display',
  feedback: 'Feedback',
  media: 'Media',
};

export function searchComponents(query: string): ComponentDescriptor[] {
  if (!query.trim()) return [...COMPONENT_CATALOG];
  const lower = query.toLowerCase();
  return COMPONENT_CATALOG.filter(
    (d) =>
      d.label.toLowerCase().includes(lower) ||
      d.kind.toLowerCase().includes(lower) ||
      d.category.toLowerCase().includes(lower) ||
      d.previewHint.toLowerCase().includes(lower),
  );
}
