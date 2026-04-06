export const getFunctions = () => ({});
export const httpsCallable = (funcs, name) => async (data) => {
    if (name === 'getCompanyProfile') {
        return { data: { name: 'NAD Tally (Offline)', id: 'offline-company', currency: 'AED' } };
    }
    if (name === 'getTeamList') {
        return { data: [] };
    }
    if (name === 'getPartyStatement') {
        return { data: { filteredTx: [], summary: { dr: 0, cr: 0, bal: 0 } } };
    }
    return { data: { success: true } };
};
