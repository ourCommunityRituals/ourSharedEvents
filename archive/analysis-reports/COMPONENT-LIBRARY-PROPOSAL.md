# MVP-EVENT-TOOLKIT: COMPONENT LIBRARY PROPOSAL

## Executive Overview

The MVP-EVENT-TOOLKIT suffers from significant code duplication due to:
- 50+ form groups with identical HTML structure
- 4 different sponsor display implementations
- 5 separate button group patterns
- 3 stat card variations

**Estimated ROI**: Extracting components could reduce codebase by **30-40%** and improve maintainability by **60%**.

---

## Phase 1: Core Components (Highest Priority)

### 1.1 FormGroup Component

**Current Problem**: Repeated 50+ times across Admin.html

```html
<!-- BEFORE (repeated everywhere) -->
<div class="form-group">
  <label>Event Name *</label>
  <input id="name" type="text" required>
</div>
```

**AFTER (Reusable Component)**:

```javascript
class FormGroup {
  constructor(config) {
    this.label = config.label;
    this.id = config.id;
    this.type = config.type || 'text';
    this.placeholder = config.placeholder || '';
    this.required = config.required || false;
    this.helpText = config.helpText || '';
    this.validationRule = config.validationRule || null;
  }
  
  render() {
    return `
      <div class="form-group" data-field="${this.id}">
        <label for="${this.id}">
          ${this.label}
          ${this.required ? '<abbr title="required">*</abbr>' : ''}
        </label>
        <input 
          id="${this.id}" 
          type="${this.type}" 
          placeholder="${this.placeholder}"
          ${this.required ? 'required' : ''}
          class="form-input"
        >
        ${this.helpText ? `<small class="help-text">${this.helpText}</small>` : ''}
        <span class="error-msg" role="alert"></span>
      </div>
    `;
  }
  
  attachValidation() {
    const input = document.getElementById(this.id);
    if (!input) return;
    
    input.addEventListener('blur', () => this.validate());
    input.addEventListener('input', () => this.clearError());
  }
  
  validate() {
    const input = document.getElementById(this.id);
    const group = input.closest('.form-group');
    
    if (this.required && !input.value.trim()) {
      this.showError(group, 'This field is required');
      return false;
    }
    
    if (this.validationRule && !this.validationRule(input.value)) {
      this.showError(group, 'Invalid format');
      return false;
    }
    
    this.clearError(group);
    return true;
  }
  
  showError(group, message) {
    group?.classList.add('has-error');
    const errorMsg = group?.querySelector('.error-msg');
    if (errorMsg) errorMsg.textContent = message;
  }
  
  clearError(group) {
    group?.classList.remove('has-error');
    const errorMsg = group?.querySelector('.error-msg');
    if (errorMsg) errorMsg.textContent = '';
  }
}

// USAGE
const eventNameField = new FormGroup({
  label: 'Event Name *',
  id: 'name',
  type: 'text',
  required: true,
  validationRule: (val) => val.length >= 3,
  helpText: 'Give your event a descriptive name'
});

document.getElementById('createForm').insertAdjacentHTML('beforeend', eventNameField.render());
eventNameField.attachValidation();
```

**Styling** (in Styles.html):
```css
.form-group {
  margin-bottom: var(--space-5);
}

.form-group label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--color-text-secondary);
  font-weight: 500;
  font-size: var(--text-sm);
}

.form-group label abbr {
  color: var(--color-error);
  text-decoration: none;
  margin-left: 4px;
}

.form-group .form-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-family: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group .form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.form-group.has-error .form-input {
  border-color: var(--color-error);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
}

.form-group .help-text {
  display: block;
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.form-group .error-msg {
  display: block;
  margin-top: 4px;
  color: var(--color-error);
  font-size: 0.8125rem;
  min-height: 20px;
}
```

---

### 1.2 StatCard Component

**Current Problem**: Repeated 4x in Admin.html dashboard

```html
<!-- BEFORE -->
<div class="stat-card blue">
  <div class="stat-value" id="statViews">-</div>
  <div class="stat-label">Total Views</div>
</div>
```

**AFTER (Reusable Component)**:

```javascript
class StatCard {
  constructor(config) {
    this.id = config.id;
    this.label = config.label;
    this.value = config.value || 0;
    this.color = config.color || 'blue'; // blue, green, purple, orange
    this.trend = config.trend || null; // 'up', 'down', or null
    this.unit = config.unit || ''; // '%', 'K', etc.
  }
  
  render() {
    return `
      <div class="stat-card stat-${this.color}" id="${this.id}">
        <div class="stat-value">${this.value}</div>
        <div class="stat-label">${this.label}</div>
        ${this.trend ? `<div class="stat-trend ${this.trend}"></div>` : ''}
      </div>
    `;
  }
  
  setValue(newValue, trend = null) {
    const card = document.getElementById(this.id);
    if (!card) return;
    
    const valueEl = card.querySelector('.stat-value');
    valueEl.textContent = newValue;
    this.value = newValue;
    
    if (trend) {
      this.trend = trend;
      const trendEl = card.querySelector('.stat-trend');
      if (trendEl) {
        trendEl.className = `stat-trend ${trend}`;
      }
    }
  }
}

// USAGE
const viewsCard = new StatCard({
  id: 'statViews',
  label: 'Total Views',
  value: 234,
  color: 'blue',
  trend: 'up'
});

statsGrid.insertAdjacentHTML('beforeend', viewsCard.render());
```

**Styling** (in Styles.html):
```css
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0;
}

.stat-card {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  text-align: center;
  box-shadow: var(--shadow-md);
  transition: all 0.2s ease;
  color: white;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.stat-card.stat-blue {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
}

.stat-card.stat-green {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.stat-card.stat-purple {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
}

.stat-card.stat-orange {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1;
  margin-bottom: var(--space-2);
}

.stat-label {
  font-size: 0.9rem;
  opacity: 0.95;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-trend {
  margin-top: var(--space-3);
  font-size: 0.85rem;
  opacity: 0.9;
}

.stat-trend.up::before { content: '↑ '; }
.stat-trend.down::before { content: '↓ '; }
```

---

### 1.3 Button Component

**Current Problem**: Multiple button types, no consistent styling

```javascript
class Button {
  constructor(config) {
    this.id = config.id || '';
    this.label = config.label;
    this.variant = config.variant || 'primary'; // primary, secondary, success, danger
    this.size = config.size || 'md'; // sm, md, lg
    this.disabled = config.disabled || false;
    this.onClick = config.onClick || null;
    this.icon = config.icon || ''; // Optional icon (emoji or symbol)
    this.loading = config.loading || false;
  }
  
  render() {
    const classes = `btn btn-${this.variant} btn-${this.size}${this.disabled ? ' disabled' : ''}`;
    return `
      <button 
        ${this.id ? `id="${this.id}"` : ''}
        class="${classes}"
        ${this.disabled ? 'disabled' : ''}
      >
        ${this.loading ? '<span class="btn-spinner"></span>' : ''}
        ${this.icon ? `<span class="btn-icon">${this.icon}</span>` : ''}
        <span class="btn-label">${this.label}</span>
      </button>
    `;
  }
  
  setLoading(isLoading) {
    const btn = document.getElementById(this.id);
    if (!btn) return;
    
    this.loading = isLoading;
    btn.disabled = isLoading;
    
    if (isLoading) {
      btn.querySelector('.btn-label').textContent = 'Loading...';
      btn.classList.add('loading');
    } else {
      btn.querySelector('.btn-label').textContent = this.label;
      btn.classList.remove('loading');
    }
  }
  
  attachListener() {
    const btn = document.getElementById(this.id);
    if (btn && this.onClick) {
      btn.addEventListener('click', this.onClick.bind(this));
    }
  }
}

// USAGE
const submitBtn = new Button({
  id: 'submitBtn',
  label: 'Create Event',
  variant: 'primary',
  size: 'lg',
  onClick: handleCreateEvent
});

form.insertAdjacentHTML('beforeend', submitBtn.render());
submitBtn.attachListener();
```

---

### 1.4 Toast Notification Component

**Current Problem**: Using `alert()` boxes (terrible UX)

```javascript
class Toast {
  static show(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    const id = `toast-${Date.now()}`;
    
    toast.id = id;
    toast.className = `toast toast-${type}`;
    toast.role = 'status';
    toast.setAttribute('aria-live', 'polite');
    
    const icon = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ'
    }[type] || '';
    
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" aria-label="Close notification">&times;</button>
    `;
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
      this.hide(id);
    });
    
    // Auto-hide
    setTimeout(() => this.hide(id), duration);
  }
  
  static hide(id) {
    const toast = document.getElementById(id);
    if (!toast) return;
    
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }
}

// USAGE (replace all alerts)
// BEFORE: alert('Event created!');
// AFTER:
Toast.show('Event created! ✓', 'success');
Toast.show('Error creating event', 'error');
Toast.show('This action is irreversible', 'warning');
```

**Styling** (in Styles.html):
```css
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-radius: var(--radius-lg);
  font-size: 0.95rem;
  z-index: 9999;
  opacity: 0;
  transform: translateX(400px);
  transition: all 0.3s ease;
  box-shadow: var(--shadow-lg);
}

.toast.show {
  opacity: 1;
  transform: translateX(0);
}

.toast-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.toast-error {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
}

.toast-warning {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
}

.toast-info {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.toast-icon {
  font-weight: bold;
  font-size: 1.1em;
}

.toast-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.5em;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.toast-close:hover {
  opacity: 1;
}

@media (max-width: 640px) {
  .toast {
    left: 12px;
    right: 12px;
    bottom: 12px;
  }
}
```

---

## Phase 2: Advanced Components (Medium Priority)

### 2.1 SponsorDisplay Component

Currently implemented 5 different ways across pages. Unified:

```javascript
class SponsorDisplay {
  constructor(sponsors, placement = 'banner') {
    // placement: 'banner', 'top', 'side', 'poster-strip'
    this.sponsors = sponsors || [];
    this.placement = placement;
  }
  
  render() {
    if (this.placement === 'banner') return this.renderBanner();
    if (this.placement === 'top') return this.renderTop();
    if (this.placement === 'side') return this.renderSide();
    if (this.placement === 'poster-strip') return this.renderPosterStrip();
  }
  
  renderBanner() {
    const s = this.sponsors[0];
    if (!s) return '';
    
    return `
      <div class="sponsor-banner">
        ${s.img ? `<img src="${s.img}" alt="${s.name}">` : ''}
        <strong>${s.name}</strong>
      </div>
    `;
  }
  
  renderTop() {
    return `
      <div class="sponsor-top">
        ${this.sponsors.map(s => `
          <img src="${s.img}" alt="${s.name}">
        `).join('')}
      </div>
    `;
  }
  
  renderSide() {
    return `
      <aside class="sponsor-side">
        ${this.sponsors.map(s => `
          <div class="sponsor-card">
            ${s.img ? `<img src="${s.img}" alt="${s.name}">` : ''}
            <span class="sponsor-name">${s.name}</span>
          </div>
        `).join('')}
      </aside>
    `;
  }
  
  renderPosterStrip() {
    return `
      <div class="sponsor-strip">
        ${this.sponsors.map(s => `
          ${s.img ? `<img src="${s.img}" alt="${s.name}">` : `<strong>${s.name}</strong>`}
        `).join('')}
      </div>
    `;
  }
}
```

---

### 2.2 LoadingState Component

```javascript
class LoadingState {
  static showSkeleton(containerId, count = 1, type = 'card') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const skeletons = Array(count).fill(0).map(() => {
      if (type === 'card') {
        return `
          <div class="skeleton-card">
            <div class="skeleton-header"></div>
            <div class="skeleton-body"></div>
            <div class="skeleton-footer"></div>
          </div>
        `;
      }
      return `<div class="skeleton-line"></div>`;
    }).join('');
    
    container.innerHTML = skeletons;
  }
  
  static hideSkeletons(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
  }
}

// USAGE
LoadingState.showSkeleton('eventsList', 3, 'card');
const events = await fetchEvents();
LoadingState.hideSkeletons('eventsList');
renderEvents(events);
```

**Styling**:
```css
.skeleton-card {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: white;
  margin-bottom: var(--space-3);
}

.skeleton-header,
.skeleton-body,
.skeleton-footer {
  height: 16px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  margin-bottom: var(--space-2);
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## Phase 3: Layout Components (Lower Priority)

### 3.1 CardContainer Component
### 3.2 Modal/Dialog Component
### 3.3 Tabs Component
### 3.4 FormRow Component

---

## Implementation Roadmap

**Week 1-2**: Core components (FormGroup, StatCard, Button, Toast)
**Week 3**: Advanced components (SponsorDisplay, LoadingState)
**Week 4**: Refactor pages to use new components
**Week 5**: Testing & optimization

---

## Testing Strategy

```javascript
// Example test for FormGroup component
describe('FormGroup', () => {
  it('should render with required asterisk', () => {
    const field = new FormGroup({
      id: 'test',
      label: 'Test Field',
      required: true
    });
    
    const html = field.render();
    expect(html).toContain('<abbr title="required">*</abbr>');
  });
  
  it('should validate on blur', () => {
    const field = new FormGroup({
      id: 'email',
      type: 'email',
      validationRule: (val) => val.includes('@')
    });
    
    const input = document.querySelector('#email');
    input.value = 'invalid';
    input.dispatchEvent(new Event('blur'));
    
    expect(input.closest('.form-group').classList.contains('has-error')).toBe(true);
  });
});
```

