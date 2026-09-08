import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PRODUCTION_PRIORITIES,
  PRODUCTION_PRIORITY_LABELS,
} from "@/lib/production/constants";
import type { ProductionBoardFilters } from "@/lib/production/types";

type ProductionBoardFilterFieldsProps = {
  filters: ProductionBoardFilters;
  isArchivedView: boolean;
  companies: Array<{ id: string; company_name: string }>;
  staff: Array<{ id: string; full_name: string | null }>;
  machines: string[];
  materials: string[];
  idPrefix?: string;
};

export function ProductionBoardFilterFields({
  filters,
  isArchivedView,
  companies,
  staff,
  machines,
  materials,
  idPrefix = "",
}: ProductionBoardFilterFieldsProps) {
  const prefix = idPrefix ? `${idPrefix}-` : "";

  return (
    <>
      {isArchivedView ? <input type="hidden" name="view" value="archived" /> : null}

      <div className="space-y-2 md:col-span-2 2xl:col-span-2">
        <Label htmlFor={`${prefix}search`}>Search</Label>
        <Input
          id={`${prefix}search`}
          name="search"
          type="search"
          placeholder="Job ref, item, company, machine…"
          defaultValue={filters.search}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}company`}>Company</Label>
        <Select id={`${prefix}company`} name="company" defaultValue={filters.companyId ?? ""}>
          <option value="">All companies</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.company_name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}staff`}>Staff</Label>
        <Select id={`${prefix}staff`} name="staff" defaultValue={filters.assignedToProfileId ?? ""}>
          <option value="">All staff</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name?.trim() || "Unnamed staff member"}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}machine`}>Machine</Label>
        <Select id={`${prefix}machine`} name="machine" defaultValue={filters.machine ?? ""}>
          <option value="">All machines</option>
          {machines.map((machine) => (
            <option key={machine} value={machine}>
              {machine}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}material`}>Material</Label>
        <Select id={`${prefix}material`} name="material" defaultValue={filters.material ?? ""}>
          <option value="">All materials</option>
          {materials.map((material) => (
            <option key={material} value={material}>
              {material}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}priority`}>Priority</Label>
        <Select id={`${prefix}priority`} name="priority" defaultValue={filters.priority ?? ""}>
          <option value="">All priorities</option>
          {PRODUCTION_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRODUCTION_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}due`}>Due date</Label>
        <Select id={`${prefix}due`} name="due" defaultValue={filters.dueDate ?? ""}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="tomorrow">Due tomorrow</option>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefix}job_ref`}>Job reference</Label>
        <Input
          id={`${prefix}job_ref`}
          name="job_ref"
          placeholder="J-1048"
          defaultValue={filters.jobReference ?? ""}
        />
      </div>
    </>
  );
}

type ProductionBoardFilterActionsProps = {
  hasFilters: boolean;
  clearHref: string;
  className?: string;
  submitLabel?: string;
  onApply?: () => void;
};

export function ProductionBoardFilterActions({
  hasFilters,
  clearHref,
  className,
  submitLabel = "Apply filters",
  onApply,
}: ProductionBoardFilterActionsProps) {
  return (
    <div className={className}>
      <Button type="submit" onClick={onApply}>
        {submitLabel}
      </Button>
      {hasFilters ? (
        <Link href={clearHref}>
          <Button type="button" variant="outline" onClick={onApply}>
            Clear
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
