// Shared catalogue of the sales the site knows about, keyed by the same sale
// name the spreadsheet-upload backend uses for its sheets/GroupSizes (see
// UploaderService/appsettings.json). Each `filename` MUST match what
// UploadServiceController.DownloadNameFor produces for that sheet - that's
// how a sale picker decides whether a sale is populated or "(empty)".
// `folderLabel` names the importable bookmark folder: "Glasto <folderLabel>
// Bookmarks". Coach and General keep the specific dates/cost text that's
// actually known; the others get generic text until Hugh gives us real
// detail for them.
//
// `heading` is a function of the festival year (which comes from the
// ingested roster sheet, see BusWankersPage) so the page never hardcodes it;
// the dates and costs are deliberately NOT - they're specific and need
// editing by hand each year.
//
// Pulled out of DocumentationSection so the Groups tab (see GroupsSection)
// can offer the same sale picker without a second, drifting copy of this
// list.
export const SALE_INFO = {
  Coach: {
    label: 'Coach Tickets',
    shortLabel: 'Coach + Ticket Package Sale',
    folderLabel: 'Coach',
    heading: (year) => `${year} Glastonbury Coach Ticket Sale`,
    filename: 'coach_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'Coach + ticket package sale: 6:00pm BST, Thursday 1st October 2026',
    ],
    cost: null,
  },
  General: {
    label: 'General Sale',
    shortLabel: 'General Sale',
    folderLabel: 'General',
    heading: (year) => `${year} Glastonbury General Sale`,
    filename: 'general_autofill.csv',
    dates: [
      'Registration deadline: 5:00pm BST, Friday 25th September 2026',
      'General sale (standard tickets): 9:00am BST, Sunday 4th October 2026',
    ],
    cost: [
      "General Admission tickets (valid Wed 23rd – Sun 27th June 2027): £408 (including a £5 booking fee per ticket) plus postage and packing",
      "Deposit is £100 per person — for a 6-person group that's £600 you need in your account on ticket buying day",
    ],
  },
  'Resale - Coach': {
    label: 'Resale - Coach',
    shortLabel: 'Coach Resale',
    folderLabel: 'Coach Resale',
    heading: (year) => `${year} Glastonbury Coach Resale`,
    filename: 'coach_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  'Resale - General': {
    label: 'Resale - General',
    shortLabel: 'General Resale',
    folderLabel: 'General Resale',
    heading: (year) => `${year} Glastonbury General Resale`,
    filename: 'general_resale_autofill.csv',
    dates: ['Dates to be confirmed — check with your group organiser before use.'],
    cost: null,
  },
  Demo: {
    label: 'Demo',
    shortLabel: 'Demo Sale',
    folderLabel: 'Demo',
    heading: (year) => `${year} Glastonbury Demo Sale`,
    filename: 'demo_autofill.csv',
    dates: ['For testing/demonstration only — not a real sale.'],
    cost: null,
  },
};

export const formatWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
