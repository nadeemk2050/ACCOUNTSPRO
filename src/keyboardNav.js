/**
 * keyboardNav — light, DOM-driven keyboard navigation helpers.
 *
 * Deliberately stateless on the React side: the "cursor" is a CSS class, so
 * pressing arrows never triggers a re-render (keeps the app snappy).
 *
 *  • Gateway: walks the menu items, then the Business Overview area, then wraps.
 *  • Search dialogs: walks the result rows.
 */

const ROW_ACTIVE = 'kb-row-active';
const DASH_ACTIVE = 'kb-dash-active';

export const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
};

const clearClass = (cls) => {
    document.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
};

// ── Search dialogs ──────────────────────────────────────────────────────────
export const moveRowHighlight = (dir) => {
    const rows = Array.from(document.querySelectorAll('[data-kb-row]'));
    if (!rows.length) return false;
    const active = rows.find(r => r.classList.contains(ROW_ACTIVE));
    let idx = active ? rows.indexOf(active) : -1;
    idx = idx === -1 ? (dir > 0 ? 0 : rows.length - 1) : (idx + dir + rows.length) % rows.length;
    clearClass(ROW_ACTIVE);
    const el = rows[idx];
    el.classList.add(ROW_ACTIVE);
    el.scrollIntoView({ block: 'nearest' });
    return true;
};

export const activateHighlightedRow = () => {
    const active = document.querySelector(`.${ROW_ACTIVE}`);
    if (!active) return false;
    active.click();
    return true;
};

export const clearRowHighlight = () => clearClass(ROW_ACTIVE);

// ── Gateway (menu -> Business Overview -> wrap) ─────────────────────────────
const gatewayItems = () => {
    const menu = Array.from(document.querySelectorAll('.tally-item-btn'));
    const dash = Array.from(document.querySelectorAll('[data-dash-nav] tr'));
    return [...menu, ...dash];
};

export const gatewayNavStep = (dir) => {
    // If the old focus-based menu navigation is already engaged, leave it alone.
    if (document.activeElement && document.activeElement.classList &&
        document.activeElement.classList.contains('tally-item-btn')) {
        return false;
    }
    const items = gatewayItems();
    if (!items.length) return false;
    const active = items.find(el => el.classList.contains(DASH_ACTIVE));
    let idx = active ? items.indexOf(active) : -1;
    idx = idx === -1 ? (dir > 0 ? 0 : items.length - 1) : (idx + dir + items.length) % items.length;
    clearClass(DASH_ACTIVE);
    const el = items[idx];
    el.classList.add(DASH_ACTIVE);
    el.scrollIntoView({ block: 'nearest' });
    return true;
};

export const gatewayActivate = () => {
    const active = document.querySelector(`.${DASH_ACTIVE}`);
    if (active) { active.click(); return true; }
    return false;
};

export const clearGatewayHighlight = () => clearClass(DASH_ACTIVE);
