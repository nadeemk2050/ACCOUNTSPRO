/**
 * QuickAccPro API Layer
 * All communication with AccountsPro happens via the accproApi cloud function.
 * No Firebase SDK needed — pure REST calls.
 */

const API_ENDPOINT = 'https://cashshams.web.app/accproApi'

// ─── Storage keys ────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  API_KEY: 'quickaccpro_api_key',
  COMPANY: 'quickaccpro_company',
  SESSION: 'quickaccpro_session',
}

// ─── Stored state helpers ────────────────────────────────────────────────────

export function getStoredApiKey() {
  return localStorage.getItem(STORAGE_KEYS.API_KEY)
}

export function setStoredApiKey(key) {
  if (key) localStorage.setItem(STORAGE_KEYS.API_KEY, key)
  else localStorage.removeItem(STORAGE_KEYS.API_KEY)
}

export function getStoredCompany() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setStoredCompany(data) {
  if (data) localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(data))
  else localStorage.removeItem(STORAGE_KEYS.COMPANY)
}

export function getStoredSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.SESSION)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setStoredSession(data) {
  if (data) sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(data))
  else sessionStorage.removeItem(STORAGE_KEYS.SESSION)
}

const SUB_USER_KEY = 'quickaccpro_sub_user'

export function getStoredSubUser() {
  try {
    const raw = localStorage.getItem(SUB_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setStoredSubUser(data) {
  if (data) localStorage.setItem(SUB_USER_KEY, JSON.stringify(data))
  else localStorage.removeItem(SUB_USER_KEY)
}

export function clearAllStorage() {
  localStorage.removeItem(STORAGE_KEYS.API_KEY)
  localStorage.removeItem(STORAGE_KEYS.COMPANY)
  localStorage.removeItem(SUB_USER_KEY)
  sessionStorage.removeItem(STORAGE_KEYS.SESSION)
}

// ─── Core API call ───────────────────────────────────────────────────────────

async function callApi(action, params = {}, method = 'GET') {
  const apiKey = getStoredApiKey()
  if (!apiKey) throw new Error('No API key. Please login again.')

  const url = new URL(API_ENDPOINT)
  url.searchParams.set('action', action)

  const headers = {
    'x-api-key': apiKey,
    'x-device-info': `QuickAccPro/${navigator.userAgent || 'web'}`,
    'x-device-name': `QuickAccPro Web`,
  }

  // Auto-inject logged-in user info into POST requests
  const subUser = getStoredSubUser()
  
  let body = null
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ 
      action, 
      ...params,
      // Pass user identity for audit logging
      ...(subUser ? { 
        subUserId: subUser.id,
        userName: subUser.name
      } : {})
    })
  } else {
    // GET: append params as query string
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    })
  }

  const res = await fetch(url.toString(), { method, headers, body })
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || data.message || `API error (${res.status})`)
  }

  return data
}

// ─── Public API functions ─────────────────────────────────────────────────────

/** Validate an API key and return company info */
export async function validateApiKey(apiKey) {
  const url = new URL(API_ENDPOINT)
  url.searchParams.set('action', 'validate_key')
  url.searchParams.set('apiKey', apiKey)

  const res = await fetch(url.toString(), {
    headers: {
      'x-device-info': `QuickAccPro/${navigator.userAgent || 'web'}`,
      'x-device-name': 'QuickAccPro Web',
    }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Invalid API key')
  return data
}

/** Get dashboard summary (receivable, payable, cash balance) */
export async function getSummary() {
  return callApi('summary')
}

/** List all cash/bank accounts */
export async function listAccounts() {
  return callApi('list_accounts')
}

/** List all ledgers (parties, expenses, assets) */
export async function listLedgers() {
  return callApi('list_ledgers')
}

/** Get daybook transactions (invoices, payments, journal vouchers) */
export async function getDaybook(limit = 50) {
  return callApi('list_daybook', { limit })
}

/**
 * Get ALL daybook records via POST — bypasses GET query param limits.
 * Uses max limit + fetchAll flag to ensure 100% of vouchers are returned.
 */
export async function getDaybookAll(startDate, endDate) {
  return callApi('list_daybook', { 
    limit: 999999, 
    fetchAll: '1',
    all: 'true',
    startDate,
    endDate
  }, 'POST')
}

/**
 * Get account-specific ledger with ALL vouchers for that account.
 * Uses POST to avoid GET param truncation, and passes accountName
 * for server-side filtering (more reliable than client-side filter).
 */
export async function getAccountLedger(accountName, startDate, endDate) {
  return callApi('list_daybook', { 
    accountName,
    limit: 999999, 
    fetchAll: '1',
    all: 'true',
    startDate,
    endDate
  }, 'POST')
}

/** List all CONTRA entries (full list for account matching) */
export async function listContra(startDate, endDate) {
  return callApi('list_daybook', { 
    type: 'contra',
    limit: 999999,
    fetchAll: '1',
    all: 'true',
    startDate,
    endDate
  }, 'POST')
}

/** List team members */
export async function listTeam() {
  return callApi('list_team')
}

/** Verify a sub-user (team member) login */
export async function verifyTeamLogin(username, password) {
  return callApi('verify_team_login', { username, password }, 'POST')
}

/** List invoices for a specific party */
export async function listPartyInvoices(partyId) {
  return callApi('list_party_invoices', { partyId })
}

/** Add a payment (expense/receipt) via API */
export async function addPayment(params) {
  return callApi('add_payment', params, 'POST')
}

/** Add a contra entry (bank-to-bank transfer) via API */
export async function addContra(params) {
  return callApi('add_contra', params, 'POST')
}

/** Check if a reference number already exists */
export async function checkRefNo(refNo) {
  return callApi('check_ref_no', { refNo })
}

/** Get voucher details for edit */
export async function getVoucher(voucherId) {
  return callApi('get_voucher', { voucherId })
}

/** Update an existing voucher */
export async function updateVoucher(voucherId, params) {
  return callApi('edit_voucher', { voucherId, ...params }, 'POST')
}

/** Delete a voucher with password protection */
export async function deleteVoucher(voucherId, password, subUserId, userName) {
  return callApi('delete_voucher', { voucherId, password, subUserId, userName }, 'POST')
}

/** Trigger backend sync/rebuild of live records from top-level collections */
export async function rebuildLiveRecords() {
  return callApi('rebuild_live_records', {}, 'POST')
}

