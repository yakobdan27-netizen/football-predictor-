"use client";

interface PickSegmentProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function PickSegment({
  options,
  value,
  onChange,
  ariaLabel = "Your pick",
}: PickSegmentProps) {
  return (
    <div className="pick-segment" role="group" aria-label={ariaLabel}>
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          className={`pick-segment-btn${value === v ? " selected" : ""}`}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
