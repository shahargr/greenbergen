// The permit form library, v1: the right PDFs surfaced for download. New
// Jersey's Uniform Construction Code forms are statewide (NJ DCA); the
// contractor brings them filled in, the homeowner signs. Town-specific
// forms are "not in the library yet" until a town is added here.
export type PermitForm = { code: string; title: string; note: string; url: string; pages: number | null; trades: string[] };

export const NJ_UCC_FORMS: PermitForm[] = [
  { code: "F100", title: "Construction permit application", note: "NJ UCC F100 · the jacket every permit starts with", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f100.pdf", pages: 4, trades: ["*"] },
  { code: "F110", title: "Building subcode technical section", note: "NJ UCC F110", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f110.pdf", pages: 3, trades: ["Decks", "General Contractor", "Siding", "Hardscaping"] },
  { code: "F120", title: "Electrical subcode technical section", note: "NJ UCC F120", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f120.pdf", pages: 2, trades: ["Electrical"] },
  { code: "F140", title: "Plumbing subcode technical section", note: "NJ UCC F140", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f140.pdf", pages: 2, trades: ["Plumbing"] },
  { code: "F130", title: "Fire protection subcode technical section", note: "NJ UCC F130 · generators with fuel lines", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f130.pdf", pages: 2, trades: ["generator"] },
  { code: "F145", title: "Mechanical inspector technical section", note: "NJ UCC F145 · gas appliance replacements in 1- and 2-family homes", url: "https://www.nj.gov/dca/codes/forms/pdf_ucc/ucc_f145.pdf", pages: 2, trades: ["water_heater", "generator"] },
];

export const formsFor = (trade: string | null, packageCode: string) =>
  NJ_UCC_FORMS.filter((f) => f.trades.includes("*") || (trade && f.trades.includes(trade)) || f.trades.includes(packageCode));
