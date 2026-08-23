# Ledger

Ledger is a browser-only crypto scenario calculator. Add manually entered holdings, assign hypothetical prices, and view projected portfolio values without live market data, accounts, or a server.

## Features

- Track crypto assets, amounts held, notes, and logos.
- Use built-in coin marks or upload custom PNG, JPG, WebP, or SVG logos.
- Create and switch between hypothetical price scenarios.
- View total projected value and portfolio allocation by scenario.
- Calculate partial-sale proceeds at a chosen price.
- Build a multi-level sell or exit plan.
- Add target prices and compare them with a manual reference price.
- Run one-off calculations in the Calculator view.
- Display values in USD, PHP, or EUR using manually configured conversion rates.
- Choose light, dark, or system theme.
- Export and import portfolio data as JSON.

## Getting Started

1. Open `index.html` in a modern browser.
2. Select **Portfolio** and choose **Add Asset**.
3. Enter the coin name, symbol, and amount held.
4. Open **Scenarios**, create a scenario, and enter a hypothetical USD price for each asset.
5. Select the scenario to display its projected total on the Portfolio screen.

Prices are entered in USD. Display-currency conversion only affects how values are shown.

## Views

### Portfolio

Shows all saved assets, their holdings, projected values, target prices, and allocation for the active scenario. Assets without a price in the active scenario are excluded from the projected total.

### Scenarios

Create, edit, rename, duplicate, compare, select, and delete hypothetical price sets. A scenario can leave an asset price blank to exclude that asset from its total.

### Calculator

Calculates `amount × price` for a one-off estimate. Calculator values are not saved to the portfolio.

### Settings

Configure display currency, manual PHP and EUR conversion rates, theme, precision preference, data export, data import, and reset.

## Storage and Privacy

All portfolio data is stored locally in the current browser:

- `localStorage` stores the main portfolio state.
- IndexedDB stores uploaded custom logo files.
- No data is sent to a backend or market-data service.
- Clearing browser site data removes the saved portfolio and uploaded logos.

The Google Fonts stylesheet is the only external resource referenced by the page. The app remains functional without it using its fallback fonts.

## Backup and Import

Use **Settings > Backup > Export Data** to download a JSON backup. Importing a backup replaces the current portfolio after confirmation, so export the current data first if it may be needed later.

A backup includes:

- Assets and amounts
- Scenarios and prices
- Selected scenario
- Display settings
- Available custom logo data

## Local Development

This is a static vanilla HTML, CSS, and JavaScript project. No build step or package installation is required.

For a simple local server, run one of the following from the project directory:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Directly opening `index.html` also works in browsers that allow local file access.

## Project Structure

```text
index.html  Application shell and navigation markup
style.css   Layout, responsive styles, themes, and component styles
script.js   State, rendering, calculations, storage, and event handling
README.md   Project documentation
```

## Browser Support

Use a current version of Chrome, Edge, Firefox, or Safari. The app uses modern browser APIs including:

- `localStorage`
- IndexedDB
- `FileReader`
- `Blob` and download URLs
- Clipboard API, when available
- `prefers-color-scheme`

If IndexedDB or the Clipboard API is unavailable, the related custom-logo or copy feature may not work, but the main calculator remains usable.

## Limitations

- Prices and conversion rates are manual and are not financial advice.
- There are no live prices, exchange-rate updates, authentication, or cloud sync.
- Data is tied to the browser profile and device where it was entered.
- Uploaded logos are limited to 3 MB each.
- The precision setting is available in the interface but is not currently applied to formatting.
