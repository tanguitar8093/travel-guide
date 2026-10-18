import { useEffect, useId, useState } from "react";
import type { Ref } from "react";
import "./SearchableSelect.css";

export interface SearchableOption {
  id: string;
  name: string;
  color?: string;
  depth?: number;
  disabled?: boolean;
  description?: string;
}

export function SearchableSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  inputId,
  inputRef,
  autoFocus = false,
  onQueryChange,
  ariaRequired = false,
}: {
  label: string;
  placeholder: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onQueryChange?: () => void;
  ariaRequired?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = options.find((option) => option.id === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) =>
    option.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const expanded = open && !disabled;

  useEffect(() => {
    if (expanded && activeIndex >= 0) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, expanded, id]);

  function select(option: SearchableOption) {
    if (option.disabled) return;
    onChange(option.id);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  return (
    <div className="searchable-select">
      <input
        id={inputId}
        ref={inputRef}
        autoFocus={autoFocus}
        type="text"
        role="combobox"
        aria-label={label}
        aria-required={ariaRequired}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          expanded && filtered[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={expanded ? query : (selected?.name ?? "")}
        onFocus={() => {
          setQuery("");
          setOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
          setActiveIndex(-1);
        }}
        onChange={(event) => {
          onQueryChange?.();
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((current) => {
              let next = current < 0
                ? (direction === 1 ? 0 : filtered.length - 1)
                : current + direction;
              while (next >= 0 && next < filtered.length) {
                if (!filtered[next].disabled) return next;
                next += direction;
              }
              return filtered[current] && !filtered[current].disabled ? current : -1;
            });
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            if (filtered[activeIndex]) select(filtered[activeIndex]);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault();
            setOpen(false);
            setQuery("");
            setActiveIndex(-1);
          }
        }}
      />
      {expanded && (
        <ul id={`${id}-options`} role="listbox" aria-label={label}>
          {filtered.length ? (
            filtered.map((option, index) => (
              <li
                id={`${id}-option-${index}`}
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                aria-disabled={option.disabled || undefined}
                className={activeIndex === index ? "active" : ""}
                style={{ paddingInlineStart: 10 + (option.depth ?? 0) * 12 }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option)}
              >
                {option.color && (
                  <i
                    className="searchable-color"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                )}
                <span>
                  {option.name}
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.id === value && <span aria-hidden="true">✓</span>}
              </li>
            ))
          ) : (
            <li className="searchable-empty" role="presentation">
              找不到符合的選項
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
