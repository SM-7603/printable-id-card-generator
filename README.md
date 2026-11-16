# Printable ID Cards

A browser-only generator for credit-card-size (85.6 × 54 mm) ID cards with Code 128 barcodes.
No server, no install, no internet needed — open `index.html` and go.

## Use it

1. **People** — drop a CSV on the page, or paste names (straight from Excel/Sheets works too).
2. **Check the list** — the *People & IDs* table shows every generated ID and flags anything odd:
   shortened IDs, renamed duplicates, duplicate IDs in your data, names that can't produce an ID.
   Rows marked red are left off the printout until you fix them.
3. **Design** — header, subtitle, accent colour, logo.
4. **Print** — click *Print cards*. In the print dialog use **100% / Actual size**, margins **None**,
   headers & footers **off**, background graphics **on**.

*Export ID list* downloads `full_name,user_id` for everyone, so you have a record of the IDs you printed.
Settings and the name list are saved in your browser between visits; *Reset everything* clears them.

## Input formats

Columns are matched by header (case and punctuation don't matter). Recognised headers:

| Field | Headers |
| --- | --- |
| Full name | `full_name`, `name`, `employee name`, `employee`, `associate` |
| First / last | `first_name`, `first`, `given name` / `last_name`, `last`, `surname`, `family name` |
| User ID | `user_id`, `id`, `employee id`, `badge`, `badge id`, `login`, `username` |

Comma, semicolon and tab separators all work; quoted fields and Excel's UTF-8 BOM are handled.
Without a header the app guesses: one column = full name; `Full Name,ID`; `ID,Full Name`; `First,Last`; `First,Last,ID`.

## ID rules

- Generated IDs are **first initial + last name**, accents removed, letters/digits only, uppercased
  (`María García-López` → `MGARCIALOPEZ`), cut to the *Max ID length* (default 12).
- If a generated ID is already taken, a number is added (`JLEE`, `JLEE2`…) while staying within the max length.
- IDs supplied in your data are used as-is (cleaned of spaces/symbols). Duplicates among them are flagged, not silently changed.

## Files

- `index.html` — layout
- `styles.css` — app and card styling, print rules
- `app.js` — parsing, ID generation, rendering, persistence
- `barcode.js` — self-contained Code 128 encoder (SVG)
- `assets/` — default logo
