/**
 * Tests for DurationSelector component.
 *
 * Covers: format display, increment/decrement, clamping to bounds,
 * button disabled states, accessibility labels, custom props.
 */

import { render, fireEvent, screen } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'duration.label': 'Duration',
        'duration.decrease': 'Decrease duration',
        'duration.increase': 'Increase duration',
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

import { DurationSelector } from '../DurationSelector';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DurationSelector', () => {
  const defaultProps = {
    value: 60,
    onChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the label from i18n', () => {
    render(<DurationSelector {...defaultProps} />);
    expect(screen.getByText('Duration')).toBeTruthy();
  });

  it('displays duration in hours:minutes format', () => {
    render(<DurationSelector {...defaultProps} value={90} />);
    expect(screen.getByText('1h 30m')).toBeTruthy();
  });

  it('formats 30 minutes as "0h 30m"', () => {
    render(<DurationSelector {...defaultProps} value={30} />);
    expect(screen.getByText('0h 30m')).toBeTruthy();
  });

  it('formats 120 minutes as "2h 0m"', () => {
    render(<DurationSelector {...defaultProps} value={120} />);
    expect(screen.getByText('2h 0m')).toBeTruthy();
  });

  it('formats 480 minutes as "8h 0m"', () => {
    render(<DurationSelector {...defaultProps} value={480} />);
    expect(screen.getByText('8h 0m')).toBeTruthy();
  });

  it('calls onChange with decreased value on minus press', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={120} onChange={onChange} step={30} />);

    const decreaseButton = screen.getByLabelText('Decrease duration');
    fireEvent.press(decreaseButton);

    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('calls onChange with increased value on plus press', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={120} onChange={onChange} step={30} />);

    const increaseButton = screen.getByLabelText('Increase duration');
    fireEvent.press(increaseButton);

    expect(onChange).toHaveBeenCalledWith(150);
  });

  it('clamps decrease to min value', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={45} onChange={onChange} min={30} step={30} />);

    const decreaseButton = screen.getByLabelText('Decrease duration');
    fireEvent.press(decreaseButton);

    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('clamps increase to max value', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={470} onChange={onChange} max={480} step={30} />);

    const increaseButton = screen.getByLabelText('Increase duration');
    fireEvent.press(increaseButton);

    expect(onChange).toHaveBeenCalledWith(480);
  });

  it('disables decrease button at minimum value', () => {
    render(<DurationSelector value={30} onChange={jest.fn()} min={30} />);

    const decreaseButton = screen.getByLabelText('Decrease duration');
    expect(decreaseButton.props.accessibilityState).toEqual({ disabled: true });
  });

  it('disables increase button at maximum value', () => {
    render(<DurationSelector value={480} onChange={jest.fn()} max={480} />);

    const increaseButton = screen.getByLabelText('Increase duration');
    expect(increaseButton.props.accessibilityState).toEqual({ disabled: true });
  });

  it('does not call onChange when pressing disabled decrease button', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={30} onChange={onChange} min={30} />);

    const decreaseButton = screen.getByLabelText('Decrease duration');
    fireEvent.press(decreaseButton);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not call onChange when pressing disabled increase button', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={480} onChange={onChange} max={480} />);

    const increaseButton = screen.getByLabelText('Increase duration');
    fireEvent.press(increaseButton);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses custom step value', () => {
    const onChange = jest.fn();
    render(<DurationSelector value={60} onChange={onChange} step={15} />);

    const increaseButton = screen.getByLabelText('Increase duration');
    fireEvent.press(increaseButton);

    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('provides accessible button roles', () => {
    render(<DurationSelector {...defaultProps} />);

    const decreaseButton = screen.getByLabelText('Decrease duration');
    const increaseButton = screen.getByLabelText('Increase duration');

    expect(decreaseButton.props.accessibilityRole).toBe('button');
    expect(increaseButton.props.accessibilityRole).toBe('button');
  });
});
