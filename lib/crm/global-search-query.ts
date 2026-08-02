import type { SupabaseClient } from "@supabase/supabase-js";

import { formatAdminQuoteStatusLabel } from "@/lib/admin-quote-status";
import { formatGbp } from "@/lib/format-currency";
import { formatOpportunityStageLabel } from "@/lib/crm/opportunity-stages";
import { loadTaskAssigneesByTaskIds } from "@/lib/crm/task-assignees";
import { formatCrmDate } from "@/lib/crm/format-datetime";
import {
  GLOBAL_SEARCH_LIMIT_PER_CATEGORY,
  parseQuoteNumberSearchTerm,
  sanitizeGlobalSearchTerm,
} from "@/lib/crm/global-search-sanitize";

export type GlobalSearchResultType =
  | "company"
  | "contact"
  | "opportunity"
  | "quote"
  | "task";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchGroupedResults = {
  companies: GlobalSearchResult[];
  contacts: GlobalSearchResult[];
  opportunities: GlobalSearchResult[];
  quotes: GlobalSearchResult[];
  tasks: GlobalSearchResult[];
};

function emptyResults(): GlobalSearchGroupedResults {
  return {
    companies: [],
    contacts: [],
    opportunities: [],
    quotes: [],
    tasks: [],
  };
}

async function searchCompanies(
  supabase: SupabaseClient,
  ilikePattern: string
): Promise<GlobalSearchResult[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id, company_name, trading_name")
    .or(
      `company_name.ilike.${ilikePattern},trading_name.ilike.${ilikePattern},accounts_email.ilike.${ilikePattern}`
    )
    .order("company_name", { ascending: true })
    .limit(GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((company) => ({
    id: company.id,
    type: "company" as const,
    title: company.company_name,
    subtitle: company.trading_name
      ? `${company.trading_name} · Company`
      : "Company",
    href: `/admin/companies/${company.id}`,
  }));
}

async function searchContacts(
  supabase: SupabaseClient,
  ilikePattern: string,
  matchingCompanyIds: string[]
): Promise<GlobalSearchResult[]> {
  const contactIds = new Set<string>();
  const contactRows: {
    id: string;
    full_name: string;
    email: string | null;
    job_title: string | null;
    company_id: string;
    companies: { company_name: string } | { company_name: string }[] | null;
  }[] = [];

  const { data: byFields, error: byFieldsError } = await supabase
    .from("contacts")
    .select("id, full_name, email, job_title, company_id, companies ( company_name )")
    .or(
      `full_name.ilike.${ilikePattern},email.ilike.${ilikePattern},phone.ilike.${ilikePattern},job_title.ilike.${ilikePattern}`
    )
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  if (byFieldsError) {
    throw new Error(byFieldsError.message);
  }

  for (const row of byFields ?? []) {
    if (!contactIds.has(row.id)) {
      contactIds.add(row.id);
      contactRows.push(row);
    }
  }

  if (matchingCompanyIds.length > 0 && contactRows.length < GLOBAL_SEARCH_LIMIT_PER_CATEGORY) {
    const { data: byCompany, error: byCompanyError } = await supabase
      .from("contacts")
      .select("id, full_name, email, job_title, company_id, companies ( company_name )")
      .in("company_id", matchingCompanyIds)
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

    if (byCompanyError) {
      throw new Error(byCompanyError.message);
    }

    for (const row of byCompany ?? []) {
      if (contactRows.length >= GLOBAL_SEARCH_LIMIT_PER_CATEGORY) {
        break;
      }

      if (!contactIds.has(row.id)) {
        contactIds.add(row.id);
        contactRows.push(row);
      }
    }
  }

  return contactRows.slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY).map((contact) => {
    const company = Array.isArray(contact.companies)
      ? contact.companies[0]
      : contact.companies;
    const companyName = company?.company_name ?? "Unknown company";
    const detail = [companyName, contact.job_title].filter(Boolean).join(" · ");

    return {
      id: contact.id,
      type: "contact" as const,
      title: contact.full_name,
      subtitle: detail || companyName,
      href: `/admin/customers/${contact.id}`,
    };
  });
}

async function searchOpportunities(
  supabase: SupabaseClient,
  ilikePattern: string,
  matchingCompanyIds: string[],
  matchingContactIds: string[]
): Promise<GlobalSearchResult[]> {
  const opportunityIds = new Set<string>();

  const { data: byText, error: byTextError } = await supabase
    .from("opportunities")
    .select("id")
    .or(`title.ilike.${ilikePattern},description.ilike.${ilikePattern}`);

  if (byTextError) {
    throw new Error(byTextError.message);
  }

  byText?.forEach((row) => opportunityIds.add(row.id));

  if (matchingCompanyIds.length > 0) {
    const { data: byCompany, error: byCompanyError } = await supabase
      .from("opportunities")
      .select("id")
      .in("company_id", matchingCompanyIds);

    if (byCompanyError) {
      throw new Error(byCompanyError.message);
    }

    byCompany?.forEach((row) => opportunityIds.add(row.id));
  }

  if (matchingContactIds.length > 0) {
    const { data: byContact, error: byContactError } = await supabase
      .from("opportunities")
      .select("id")
      .in("contact_id", matchingContactIds);

    if (byContactError) {
      throw new Error(byContactError.message);
    }

    byContact?.forEach((row) => opportunityIds.add(row.id));
  }

  const ids = [...opportunityIds].slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("opportunities")
    .select(
      "id, title, stage, estimated_value, company_id, contact_id, companies ( company_name ), contacts ( full_name )"
    )
    .in("id", ids)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY).map((row) => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    const companyName = company?.company_name ?? "Unknown company";
    const stageLabel = formatOpportunityStageLabel(row.stage);
    const value =
      row.estimated_value !== null && row.estimated_value !== undefined
        ? formatGbp(Number(row.estimated_value))
        : null;
    const subtitleParts = [companyName, stageLabel, value, contact?.full_name]
      .filter(Boolean)
      .join(" · ");

    return {
      id: row.id,
      type: "opportunity" as const,
      title: row.title,
      subtitle: subtitleParts,
      href: `/admin/opportunities/${row.id}`,
    };
  });
}

async function searchQuotes(
  supabase: SupabaseClient,
  sanitizedTerm: string,
  ilikePattern: string,
  matchingCompanyIds: string[],
  matchingContactIds: string[],
  matchingOpportunityIds: string[]
): Promise<GlobalSearchResult[]> {
  const quoteIds = new Set<string>();
  const quoteNumber = parseQuoteNumberSearchTerm(sanitizedTerm);

  const { data: byProject, error: byProjectError } = await supabase
    .from("quotes")
    .select("id")
    .ilike("project_name", ilikePattern);

  if (byProjectError) {
    throw new Error(byProjectError.message);
  }

  byProject?.forEach((row) => quoteIds.add(row.id));

  if (quoteNumber !== null) {
    const { data: byNumber, error: byNumberError } = await supabase
      .from("quotes")
      .select("id")
      .eq("quote_number", quoteNumber);

    if (byNumberError) {
      throw new Error(byNumberError.message);
    }

    byNumber?.forEach((row) => quoteIds.add(row.id));
  }

  if (matchingCompanyIds.length > 0) {
    const { data: byCompany, error: byCompanyError } = await supabase
      .from("quotes")
      .select("id")
      .in("company_id", matchingCompanyIds);

    if (byCompanyError) {
      throw new Error(byCompanyError.message);
    }

    byCompany?.forEach((row) => quoteIds.add(row.id));
  }

  if (matchingContactIds.length > 0) {
    const { data: byContact, error: byContactError } = await supabase
      .from("quotes")
      .select("id")
      .in("contact_id", matchingContactIds);

    if (byContactError) {
      throw new Error(byContactError.message);
    }

    byContact?.forEach((row) => quoteIds.add(row.id));
  }

  if (matchingOpportunityIds.length > 0) {
    const { data: byOpportunity, error: byOpportunityError } = await supabase
      .from("quotes")
      .select("id")
      .in("opportunity_id", matchingOpportunityIds);

    if (byOpportunityError) {
      throw new Error(byOpportunityError.message);
    }

    byOpportunity?.forEach((row) => quoteIds.add(row.id));
  }

  const ids = [...quoteIds].slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, project_name, status, current_version, company_id, opportunity_id, companies ( company_name ), opportunities ( title )"
    )
    .in("id", ids)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const quotes = (data ?? []).slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  const { data: versions, error: versionsError } = await supabase
    .from("quote_versions")
    .select("quote_id, version_number, total")
    .in(
      "quote_id",
      quotes.map((quote) => quote.id)
    );

  if (versionsError) {
    throw new Error(versionsError.message);
  }

  const totalByQuoteId = new Map<string, number>();

  for (const quote of quotes) {
    const currentVersion = (versions ?? []).find(
      (version) =>
        version.quote_id === quote.id &&
        version.version_number === quote.current_version
    );
    totalByQuoteId.set(quote.id, Number(currentVersion?.total ?? 0));
  }

  return quotes.map((quote) => {
    const company = Array.isArray(quote.companies)
      ? quote.companies[0]
      : quote.companies;
    const opportunity = Array.isArray(quote.opportunities)
      ? quote.opportunities[0]
      : quote.opportunities;
    const companyName = company?.company_name ?? "Unknown company";
    const statusLabel = formatAdminQuoteStatusLabel(quote.status);
    const total = totalByQuoteId.get(quote.id) ?? 0;
    const subtitle = [companyName, statusLabel, formatGbp(total), opportunity?.title]
      .filter(Boolean)
      .join(" · ");

    return {
      id: quote.id,
      type: "quote" as const,
      title: `Q-${quote.quote_number} · ${quote.project_name}`,
      subtitle,
      href: `/admin/quotes/${quote.id}`,
    };
  });
}

async function searchTasks(
  supabase: SupabaseClient,
  ilikePattern: string,
  matchingCompanyIds: string[],
  matchingOpportunityIds: string[],
  matchingAssigneeIds: string[]
): Promise<GlobalSearchResult[]> {
  const taskIds = new Set<string>();

  const { data: byText, error: byTextError } = await supabase
    .from("tasks")
    .select("id")
    .or(`title.ilike.${ilikePattern},description.ilike.${ilikePattern}`);

  if (byTextError) {
    throw new Error(byTextError.message);
  }

  byText?.forEach((row) => taskIds.add(row.id));

  if (matchingCompanyIds.length > 0) {
    const { data: byCompany, error: byCompanyError } = await supabase
      .from("tasks")
      .select("id")
      .in("company_id", matchingCompanyIds);

    if (byCompanyError) {
      throw new Error(byCompanyError.message);
    }

    byCompany?.forEach((row) => taskIds.add(row.id));
  }

  if (matchingOpportunityIds.length > 0) {
    const { data: byOpportunity, error: byOpportunityError } = await supabase
      .from("tasks")
      .select("id")
      .in("opportunity_id", matchingOpportunityIds);

    if (byOpportunityError) {
      throw new Error(byOpportunityError.message);
    }

    byOpportunity?.forEach((row) => taskIds.add(row.id));
  }

  if (matchingAssigneeIds.length > 0) {
    const { data: assigneeRows, error: assigneeError } = await supabase
      .from("task_assignees")
      .select("task_id")
      .in("profile_id", matchingAssigneeIds);

    if (assigneeError) {
      throw new Error(assigneeError.message);
    }

    assigneeRows?.forEach((row) => taskIds.add(row.task_id));
  }

  const ids = [...taskIds].slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY);

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, due_at, company_id, opportunity_id, companies ( company_name ), opportunities ( title )"
    )
    .in("id", ids)
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  const tasks = (data ?? []).slice(0, GLOBAL_SEARCH_LIMIT_PER_CATEGORY);
  const assigneesByTaskId = await loadTaskAssigneesByTaskIds(
    supabase,
    tasks.map((task) => task.id)
  );

  return tasks.map((task) => {
    const company = Array.isArray(task.companies) ? task.companies[0] : task.companies;
    const opportunity = Array.isArray(task.opportunities)
      ? task.opportunities[0]
      : task.opportunities;
    const assignees = assigneesByTaskId.get(task.id) ?? [];
    const assigneeNames = assignees
      .map((assignee) => assignee.full_name?.trim())
      .filter(Boolean)
      .join(", ");
    const dueLabel = task.due_at ? `Due ${formatCrmDate(task.due_at)}` : null;
    const subtitleParts = [
      dueLabel,
      assigneeNames || null,
      company?.company_name ?? null,
      opportunity?.title ?? null,
    ].filter(Boolean);

    return {
      id: task.id,
      type: "task" as const,
      title: task.title,
      subtitle: subtitleParts.join(" · ") || "Task",
      href: `/admin/tasks/${task.id}/edit`,
    };
  });
}

export async function runGlobalSearch(
  supabase: SupabaseClient,
  rawQuery: string
): Promise<GlobalSearchGroupedResults> {
  const sanitizedTerm = sanitizeGlobalSearchTerm(rawQuery);

  if (sanitizedTerm.length < 2) {
    return emptyResults();
  }

  const ilikePattern = `%${sanitizedTerm}%`;

  const companies = await searchCompanies(supabase, ilikePattern);
  const matchingCompanyIds = companies.map((company) => company.id);

  const { data: extraCompanies } = await supabase
    .from("companies")
    .select("id")
    .or(
      `company_name.ilike.${ilikePattern},trading_name.ilike.${ilikePattern},accounts_email.ilike.${ilikePattern}`
    )
    .limit(20);

  const allMatchingCompanyIds = [
    ...new Set([
      ...matchingCompanyIds,
      ...(extraCompanies ?? []).map((company) => company.id),
    ]),
  ];

  const contacts = await searchContacts(
    supabase,
    ilikePattern,
    allMatchingCompanyIds
  );
  const matchingContactIds = contacts.map((contact) => contact.id);

  const { data: extraContacts } = await supabase
    .from("contacts")
    .select("id")
    .or(
      `full_name.ilike.${ilikePattern},email.ilike.${ilikePattern},phone.ilike.${ilikePattern},job_title.ilike.${ilikePattern}`
    )
    .eq("is_active", true)
    .limit(20);

  const allMatchingContactIds = [
    ...new Set([
      ...matchingContactIds,
      ...(extraContacts ?? []).map((contact) => contact.id),
    ]),
  ];

  const { data: matchingOpportunityRows } = await supabase
    .from("opportunities")
    .select("id")
    .or(`title.ilike.${ilikePattern},description.ilike.${ilikePattern}`)
    .limit(20);

  const matchingOpportunityIds = (matchingOpportunityRows ?? []).map(
    (row) => row.id
  );

  const { data: matchingAssignees } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", ilikePattern)
    .limit(20);

  const matchingAssigneeIds = (matchingAssignees ?? []).map((row) => row.id);

  const [opportunities, quotes, tasks] = await Promise.all([
    searchOpportunities(
      supabase,
      ilikePattern,
      allMatchingCompanyIds,
      allMatchingContactIds
    ),
    searchQuotes(
      supabase,
      sanitizedTerm,
      ilikePattern,
      allMatchingCompanyIds,
      allMatchingContactIds,
      matchingOpportunityIds
    ),
    searchTasks(
      supabase,
      ilikePattern,
      allMatchingCompanyIds,
      matchingOpportunityIds,
      matchingAssigneeIds
    ),
  ]);

  return {
    companies,
    contacts,
    opportunities,
    quotes,
    tasks,
  };
}
