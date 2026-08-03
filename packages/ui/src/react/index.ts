/**
 * @ocr/ui — React component layer (Phase 3 bridge)
 *
 * All components consume Tier 2 design tokens via Tailwind utility classes.
 * The consuming app must:
 *   1. Include `ocrTailwindPreset` in its tailwind.config.ts
 *   2. Add `'./node_modules/@ocr/ui/src/**\/*.{ts,tsx}'` to Tailwind `content`
 *   3. Load the @ocr/ui stylesheet: `<link rel="stylesheet" href="/ui.css">`
 */
export { Button } from './Button';
export type { ButtonProps } from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Loading } from './Loading';
export type { LoadingProps } from './Loading';

export { EmptyState, AccessDenied } from './EmptyState';
export type { EmptyStateProps, AccessDeniedProps } from './EmptyState';

export { Header } from './Header';
export type { HeaderProps } from './Header';

export { BottomNav } from './BottomNav';
export type { BottomNavProps, NavItem } from './BottomNav';

export { FormInput } from './FormInput';
export type { FormInputProps } from './FormInput';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { FormSelect } from './FormSelect';
export type { FormSelectProps, SelectOption } from './FormSelect';

export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';

export { RadioGroup } from './RadioGroup';
export type { RadioGroupProps, RadioOption } from './RadioGroup';

export { FormGroup } from './FormGroup';
export type { FormGroupProps } from './FormGroup';
