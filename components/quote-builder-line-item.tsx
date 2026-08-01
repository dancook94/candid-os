"use client";

import {
  ChevronDown,
  ChevronUp,
  Copy,
  Trash2,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type QuoteBuilderLineItemState = {
  clientKey: string;
  id?: string;
  title: string;
  description: string;
  quantity: string;
  unitPrice: string;
  isOptional: boolean;
  isSelected: boolean;
};

type QuoteBuilderLineItemCardProps = {
  item: QuoteBuilderLineItemState;
  index: number;
  totalItems: number;
  lineTotal: number;
  formatGbp: (value: number) => string;
  isBusy: boolean;
  isReadOnly: boolean;
  shouldFocusTitle?: boolean;
  onFocusTitle?: () => void;
  onUpdate: (
    clientKey: string,
    updates: Partial<QuoteBuilderLineItemState>
  ) => void;
  onDuplicate: (clientKey: string) => void;
  onMoveUp: (clientKey: string) => void;
  onMoveDown: (clientKey: string) => void;
  onDelete: (clientKey: string) => void;
  canDelete: boolean;
};

function IconActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function QuoteBuilderLineItemCard({
  item,
  index,
  totalItems,
  lineTotal,
  formatGbp,
  isBusy,
  isReadOnly,
  shouldFocusTitle,
  onFocusTitle,
  onUpdate,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
  canDelete,
}: QuoteBuilderLineItemCardProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const isFirst = index === 0;
  const isLast = index === totalItems - 1;
  const fieldDisabled = isBusy || isReadOnly;

  useEffect(() => {
    if (shouldFocusTitle && titleRef.current) {
      titleRef.current.focus();
      onFocusTitle?.();
    }
  }, [shouldFocusTitle, onFocusTitle]);

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-neutral-950">
            Item {index + 1}
          </h3>
          {item.isOptional && (
            <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
              Optional
            </span>
          )}
          {!isReadOnly && (
            <label className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
              <input
                id={`optional-${item.clientKey}`}
                type="checkbox"
                checked={item.isOptional}
                onChange={(event) =>
                  onUpdate(item.clientKey, {
                    isOptional: event.target.checked,
                  })
                }
                disabled={fieldDisabled}
                className="h-3.5 w-3.5 rounded border-neutral-300"
              />
              Optional item
            </label>
          )}
        </div>

        {!isReadOnly && (
          <div className="flex items-center gap-1">
            <IconActionButton
              label="Duplicate item"
              disabled={fieldDisabled}
              onClick={() => onDuplicate(item.clientKey)}
            >
              <Copy className="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="Move item up"
              disabled={fieldDisabled || isFirst}
              onClick={() => onMoveUp(item.clientKey)}
            >
              <ChevronUp className="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="Move item down"
              disabled={fieldDisabled || isLast}
              onClick={() => onMoveDown(item.clientKey)}
            >
              <ChevronDown className="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="Delete item"
              disabled={fieldDisabled || !canDelete}
              onClick={() => onDelete(item.clientKey)}
            >
              <Trash2 className="h-4 w-4" />
            </IconActionButton>
          </div>
        )}
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-4">
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`title-${item.clientKey}`} className="text-xs">
              Title
            </Label>
            <Input
              ref={titleRef}
              id={`title-${item.clientKey}`}
              value={item.title}
              onChange={(event) =>
                onUpdate(item.clientKey, { title: event.target.value })
              }
              disabled={fieldDisabled}
              placeholder="Line item title"
              className="h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`description-${item.clientKey}`} className="text-xs">
              Description
            </Label>
            <textarea
              id={`description-${item.clientKey}`}
              value={item.description}
              onChange={(event) =>
                onUpdate(item.clientKey, {
                  description: event.target.value,
                })
              }
              disabled={fieldDisabled}
              rows={2}
              placeholder="Optional description"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`quantity-${item.clientKey}`} className="text-xs">
              Quantity
            </Label>
            <Input
              id={`quantity-${item.clientKey}`}
              type="number"
              min={0}
              step="0.01"
              value={item.quantity}
              onChange={(event) =>
                onUpdate(item.clientKey, { quantity: event.target.value })
              }
              disabled={fieldDisabled}
              className="h-8"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`unit-price-${item.clientKey}`} className="text-xs">
              Unit price ex VAT
            </Label>
            <Input
              id={`unit-price-${item.clientKey}`}
              type="number"
              min={0}
              step="0.01"
              value={item.unitPrice}
              onChange={(event) =>
                onUpdate(item.clientKey, { unitPrice: event.target.value })
              }
              disabled={fieldDisabled}
              className="h-8"
            />
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-xs text-neutral-500">Line total</p>
            <p className="text-sm font-semibold text-neutral-950">
              {formatGbp(lineTotal)}
            </p>
            {item.isOptional && (
              <p className="mt-0.5 text-xs text-neutral-500">
                Excluded from quote total
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
