# GEODIS ID Card Template

## Structure

- `index.html` — main layout
- `styles.css` — styling
- `app.js` — CSV parsing, user ID generation, barcode rendering
- `assets/` — logo or other images

## Usage

1. Open `index.html` in a browser.
2. Paste names or upload a CSV.
3. Adjust branding and layout.
4. Click **Render cards**.
5. Print at **100% scale** with browser headers/footers disabled.

## Supported CSV formats

```csv
full_name
Anne Jotheeswaran
Humza Kayani
```

```csv
first_name,last_name
Anne,Jotheeswaran
Humza,Kayani
```

```csv
full_name,user_id
Anne Jotheeswaran,AJOTHEESWARA
Humza Kayani,HKAYANI
```

```csv
user_id,full_name
AJOTHEESWARA,Anne Jotheeswaran
HKAYANI,Humza Kayani
```
