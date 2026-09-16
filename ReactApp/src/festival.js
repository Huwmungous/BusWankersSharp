// The festival year the page talks about - "Glastonbury 2027", "Glasto 2027
// Running Order" and so on. The LIVE value comes from the backend: the
// "Glasto nnnn" roster sheet of the last ingested workbook names the year
// (GET /running-order carries it), and BusWankersPage threads it down to
// every section. This constant is only the fallback for a store that has no
// roster ingested yet, so the page never reads "Glastonbury undefined".
//
// Specific dates and prices (registration deadline, sale times, ticket cost)
// are NOT derived from this - they're written out in full where they appear
// and need editing by hand each year.
export const DEFAULT_YEAR = 2027;
