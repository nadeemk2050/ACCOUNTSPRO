/**
 * HDPE PE-100 water pipe specifications (PS3580 / ISO4427 / DIN 8074).
 * Source: HDPE_PE100_Pipe_Specifications.xlsx — 6 pressure classes, wall thickness
 * min/max (mm), standard weight (kg/m) and the standard lengths offered.
 *
 * Used by Auto Calc BOM → PC Wise BOM Calc. Nothing here is computed at runtime:
 * the weights come straight from the manufacturer sheet.
 */
export const HDPE100_PE_PIPE_TABLE = [
    {
        label: 'SDR-26, PN-06',
        rows: [
            { size: 40, wMin: 1.8, wMax: 2.2, kgPerM: 0.228, lengths: ['100'] },
            { size: 50, wMin: 2, wMax: 2.5, kgPerM: 0.315, lengths: ['100'] },
            { size: 63, wMin: 2.5, wMax: 3, kgPerM: 0.495, lengths: ['100'] },
            { size: 75, wMin: 2.9, wMax: 3.4, kgPerM: 0.679, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 3.5, wMax: 4.1, kgPerM: 0.98, lengths: ['12', '50'] },
            { size: 110, wMin: 4.2, wMax: 4.9, kgPerM: 1.44, lengths: ['12'] },
            { size: 125, wMin: 4.8, wMax: 5.5, kgPerM: 1.85, lengths: ['12'] },
            { size: 140, wMin: 5.4, wMax: 6.2, kgPerM: 2.32, lengths: ['12'] },
            { size: 160, wMin: 6.2, wMax: 7.1, kgPerM: 3.04, lengths: ['12'] },
            { size: 180, wMin: 6.9, wMax: 7.8, kgPerM: 3.8, lengths: ['12'] },
            { size: 200, wMin: 7.7, wMax: 8.7, kgPerM: 4.7, lengths: ['12'] },
            { size: 225, wMin: 8.6, wMax: 9.7, kgPerM: 5.9, lengths: ['12'] },
            { size: 250, wMin: 9.6, wMax: 10.8, kgPerM: 7.33, lengths: ['12'] },
            { size: 280, wMin: 10.7, wMax: 12, kgPerM: 9.1, lengths: ['12'] },
            { size: 315, wMin: 12.1, wMax: 13.5, kgPerM: 11.6, lengths: ['12'] },
            { size: 355, wMin: 13.6, wMax: 15.2, kgPerM: 14.6, lengths: ['12'] },
            { size: 400, wMin: 15.3, wMax: 17.1, kgPerM: 18.6, lengths: ['12'] },
            { size: 450, wMin: 17.2, wMax: 19.2, kgPerM: 23.5, lengths: ['12'] },
            { size: 500, wMin: 19.1, wMax: 21.3, kgPerM: 28.9, lengths: ['12'] },
            { size: 560, wMin: 21.4, wMax: 23.8, kgPerM: 36.2, lengths: ['12'] },
            { size: 630, wMin: 24.1, wMax: 26.8, kgPerM: 45.9, lengths: ['12'] },
        ]
    },
    {
        label: 'SDR-21, PN-08',
        rows: [
            { size: 40, wMin: 1.9, wMax: 2.3, kgPerM: 0.239, lengths: ['100'] },
            { size: 50, wMin: 2.4, wMax: 2.9, kgPerM: 0.374, lengths: ['100'] },
            { size: 63, wMin: 3, wMax: 3.6, kgPerM: 0.58, lengths: ['100'] },
            { size: 75, wMin: 3.6, wMax: 4.3, kgPerM: 0.83, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 4.3, wMax: 5, kgPerM: 1.19, lengths: ['12', '50'] },
            { size: 110, wMin: 5.3, wMax: 6.1, kgPerM: 1.78, lengths: ['12'] },
            { size: 125, wMin: 6, wMax: 6.9, kgPerM: 2.27, lengths: ['12'] },
            { size: 140, wMin: 6.7, wMax: 7.6, kgPerM: 2.85, lengths: ['12'] },
            { size: 160, wMin: 7.7, wMax: 8.7, kgPerM: 3.72, lengths: ['12'] },
            { size: 180, wMin: 8.6, wMax: 9.7, kgPerM: 4.69, lengths: ['12'] },
            { size: 200, wMin: 9.6, wMax: 10.8, kgPerM: 5.78, lengths: ['12'] },
            { size: 225, wMin: 10.8, wMax: 12.1, kgPerM: 7.33, lengths: ['12'] },
            { size: 250, wMin: 11.9, wMax: 13.3, kgPerM: 8.93, lengths: ['12'] },
            { size: 280, wMin: 13.4, wMax: 15, kgPerM: 11.3, lengths: ['12'] },
            { size: 315, wMin: 15, wMax: 16.8, kgPerM: 14.2, lengths: ['12'] },
            { size: 355, wMin: 16.9, wMax: 18.8, kgPerM: 18, lengths: ['12'] },
            { size: 400, wMin: 19.1, wMax: 21.3, kgPerM: 22.9, lengths: ['12'] },
            { size: 450, wMin: 21.5, wMax: 23.9, kgPerM: 28.9, lengths: ['12'] },
            { size: 500, wMin: 23.9, wMax: 26.5, kgPerM: 35.7, lengths: ['12'] },
            { size: 560, wMin: 26.7, wMax: 29.6, kgPerM: 44.7, lengths: ['12'] },
            { size: 630, wMin: 30, wMax: 33.2, kgPerM: 56.4, lengths: ['12'] },
        ]
    },
    {
        label: 'SDR-17, PN-10',
        rows: [
            { size: 25, wMin: 1.8, wMax: 2.2, kgPerM: 0.138, lengths: ['100'] },
            { size: 32, wMin: 1.9, wMax: 2.3, kgPerM: 0.189, lengths: ['100'] },
            { size: 40, wMin: 2.4, wMax: 2.9, kgPerM: 0.295, lengths: ['100'] },
            { size: 50, wMin: 3, wMax: 3.6, kgPerM: 0.463, lengths: ['100'] },
            { size: 63, wMin: 3.8, wMax: 4.4, kgPerM: 0.721, lengths: ['100'] },
            { size: 75, wMin: 4.5, wMax: 5.2, kgPerM: 1.02, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 5.4, wMax: 6.2, kgPerM: 1.48, lengths: ['12', '50'] },
            { size: 110, wMin: 6.6, wMax: 7.5, kgPerM: 2.18, lengths: ['12'] },
            { size: 125, wMin: 7.4, wMax: 8.4, kgPerM: 2.78, lengths: ['12'] },
            { size: 140, wMin: 8.3, wMax: 9.4, kgPerM: 3.48, lengths: ['12'] },
            { size: 160, wMin: 9.5, wMax: 10.7, kgPerM: 4.54, lengths: ['12'] },
            { size: 180, wMin: 10.7, wMax: 12, kgPerM: 5.71, lengths: ['12'] },
            { size: 200, wMin: 11.9, wMax: 13.3, kgPerM: 7.08, lengths: ['12'] },
            { size: 225, wMin: 13.4, wMax: 15, kgPerM: 8.95, lengths: ['12'] },
            { size: 250, wMin: 14.8, wMax: 16.5, kgPerM: 10.99, lengths: ['12'] },
            { size: 280, wMin: 16.6, wMax: 18.5, kgPerM: 13.7, lengths: ['12'] },
            { size: 315, wMin: 18.7, wMax: 20.8, kgPerM: 17.4, lengths: ['12'] },
            { size: 355, wMin: 21.1, wMax: 23.4, kgPerM: 22.1, lengths: ['12'] },
            { size: 400, wMin: 23.7, wMax: 26.3, kgPerM: 28, lengths: ['12'] },
            { size: 450, wMin: 26.7, wMax: 29.6, kgPerM: 35.4, lengths: ['12'] },
            { size: 500, wMin: 29.7, wMax: 32.9, kgPerM: 43.8, lengths: ['12'] },
            { size: 560, wMin: 33.2, wMax: 36.8, kgPerM: 54.8, lengths: ['12'] },
            { size: 630, wMin: 37.4, wMax: 41.4, kgPerM: 69.4, lengths: ['12'] },
        ]
    },
    {
        label: 'SDR-13.6, PN-12.5',
        rows: [
            { size: 20, wMin: 1.8, wMax: 2.2, kgPerM: 0.11, lengths: ['100'] },
            { size: 25, wMin: 1.9, wMax: 2.3, kgPerM: 0.144, lengths: ['100'] },
            { size: 32, wMin: 2.4, wMax: 2.9, kgPerM: 0.232, lengths: ['100'] },
            { size: 40, wMin: 3, wMax: 3.6, kgPerM: 0.356, lengths: ['100'] },
            { size: 50, wMin: 3.7, wMax: 4.3, kgPerM: 0.55, lengths: ['100'] },
            { size: 63, wMin: 4.7, wMax: 5.4, kgPerM: 0.873, lengths: ['100'] },
            { size: 75, wMin: 5.6, wMax: 6.4, kgPerM: 1.24, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 6.7, wMax: 7.6, kgPerM: 1.77, lengths: ['12', '50'] },
            { size: 110, wMin: 8.1, wMax: 9.2, kgPerM: 2.62, lengths: ['12'] },
            { size: 125, wMin: 9.2, wMax: 10.4, kgPerM: 3.37, lengths: ['12'] },
            { size: 140, wMin: 10.3, wMax: 11.6, kgPerM: 4.22, lengths: ['12'] },
            { size: 160, wMin: 11.8, wMax: 13.2, kgPerM: 5.5, lengths: ['12'] },
            { size: 180, wMin: 13.3, wMax: 14.9, kgPerM: 6.98, lengths: ['12'] },
            { size: 200, wMin: 14.7, wMax: 16.4, kgPerM: 8.56, lengths: ['12'] },
            { size: 225, wMin: 16.6, wMax: 18.5, kgPerM: 10.9, lengths: ['12'] },
            { size: 250, wMin: 18.4, wMax: 20.5, kgPerM: 13.4, lengths: ['12'] },
            { size: 280, wMin: 20.6, wMax: 22.9, kgPerM: 16.8, lengths: ['12'] },
            { size: 315, wMin: 23.2, wMax: 25.8, kgPerM: 21.2, lengths: ['12'] },
            { size: 355, wMin: 26.1, wMax: 29, kgPerM: 26.9, lengths: ['12'] },
            { size: 400, wMin: 29.4, wMax: 32.6, kgPerM: 34.1, lengths: ['12'] },
            { size: 450, wMin: 33.1, wMax: 36.7, kgPerM: 43.2, lengths: ['12'] },
            { size: 500, wMin: 36.8, wMax: 40.7, kgPerM: 53.3, lengths: ['12'] },
            { size: 560, wMin: 41.2, wMax: 45.6, kgPerM: 66.9, lengths: ['12'] },
            { size: 630, wMin: 46.3, wMax: 51.2, kgPerM: 84.6, lengths: ['12'] },
        ]
    },
    {
        label: 'SDR-11, PN-16',
        rows: [
            { size: 20, wMin: 1.9, wMax: 2.3, kgPerM: 0.112, lengths: ['100'] },
            { size: 25, wMin: 2.3, wMax: 2.8, kgPerM: 0.171, lengths: ['100'] },
            { size: 32, wMin: 2.9, wMax: 3.4, kgPerM: 0.272, lengths: ['100'] },
            { size: 40, wMin: 3.7, wMax: 4.3, kgPerM: 0.43, lengths: ['100'] },
            { size: 50, wMin: 4.6, wMax: 5.3, kgPerM: 0.67, lengths: ['100'] },
            { size: 63, wMin: 5.8, wMax: 6.6, kgPerM: 1.05, lengths: ['100'] },
            { size: 75, wMin: 6.8, wMax: 7.7, kgPerM: 1.47, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 8.2, wMax: 9.3, kgPerM: 2.12, lengths: ['12', '50'] },
            { size: 110, wMin: 10, wMax: 11.3, kgPerM: 3.14, lengths: ['12'] },
            { size: 125, wMin: 11.4, wMax: 12.8, kgPerM: 4.08, lengths: ['12'] },
            { size: 140, wMin: 12.7, wMax: 14.2, kgPerM: 5.08, lengths: ['12'] },
            { size: 160, wMin: 14.6, wMax: 16.3, kgPerM: 6.67, lengths: ['12'] },
            { size: 180, wMin: 16.4, wMax: 18.3, kgPerM: 8.42, lengths: ['12'] },
            { size: 200, wMin: 18.2, wMax: 20.3, kgPerM: 10.4, lengths: ['12'] },
            { size: 225, wMin: 20.5, wMax: 22.8, kgPerM: 13.1, lengths: ['12'] },
            { size: 250, wMin: 22.7, wMax: 25.2, kgPerM: 16.2, lengths: ['12'] },
            { size: 280, wMin: 25.4, wMax: 28.2, kgPerM: 20.3, lengths: ['12'] },
            { size: 315, wMin: 28.6, wMax: 31.7, kgPerM: 25.6, lengths: ['12'] },
            { size: 355, wMin: 32.2, wMax: 35.7, kgPerM: 32.5, lengths: ['12'] },
            { size: 400, wMin: 36.3, wMax: 40.2, kgPerM: 41.3, lengths: ['12'] },
            { size: 450, wMin: 40.9, wMax: 45.2, kgPerM: 52.3, lengths: ['12'] },
            { size: 500, wMin: 45.4, wMax: 50.2, kgPerM: 64.5, lengths: ['12'] },
            { size: 560, wMin: 50.8, wMax: 56.1, kgPerM: 80.8, lengths: ['12'] },
            { size: 630, wMin: 57.2, wMax: 63.2, kgPerM: 102, lengths: ['12'] },
        ]
    },
    {
        label: 'SDR-9, PN-20',
        rows: [
            { size: 20, wMin: 2.3, wMax: 2.8, kgPerM: 0.14, lengths: ['100'] },
            { size: 25, wMin: 2.8, wMax: 3.3, kgPerM: 0.21, lengths: ['100'] },
            { size: 32, wMin: 3.6, wMax: 4.2, kgPerM: 0.34, lengths: ['100'] },
            { size: 40, wMin: 4.5, wMax: 5.2, kgPerM: 0.54, lengths: ['100'] },
            { size: 50, wMin: 5.6, wMax: 6.4, kgPerM: 0.84, lengths: ['100'] },
            { size: 63, wMin: 7.1, wMax: 8.1, kgPerM: 1.34, lengths: ['100'] },
            { size: 75, wMin: 8.4, wMax: 9.5, kgPerM: 1.88, lengths: ['12', '50', '100'] },
            { size: 90, wMin: 10.1, wMax: 11.3, kgPerM: 2.72, lengths: ['12', '50'] },
            { size: 110, wMin: 12.3, wMax: 13.7, kgPerM: 4.04, lengths: ['12'] },
            { size: 125, wMin: 14, wMax: 15.5, kgPerM: 5.23, lengths: ['12'] },
            { size: 140, wMin: 15.7, wMax: 17.4, kgPerM: 6.57, lengths: ['12'] },
            { size: 160, wMin: 17.9, wMax: 19.9, kgPerM: 8.56, lengths: ['12'] },
            { size: 180, wMin: 20.1, wMax: 22.4, kgPerM: 10.82, lengths: ['12'] },
            { size: 200, wMin: 22.4, wMax: 24.9, kgPerM: 13.39, lengths: ['12'] },
            { size: 225, wMin: 25.2, wMax: 28, kgPerM: 16.95, lengths: ['12'] },
            { size: 250, wMin: 27.9, wMax: 30.9, kgPerM: 20.85, lengths: ['12'] },
            { size: 280, wMin: 31.3, wMax: 34.7, kgPerM: 26.2, lengths: ['12'] },
            { size: 315, wMin: 35.2, wMax: 39, kgPerM: 33.15, lengths: ['12'] },
            { size: 355, wMin: 39.7, wMax: 43.9, kgPerM: 42.13, lengths: ['12'] },
            { size: 400, wMin: 44.7, wMax: 49.4, kgPerM: 53.45, lengths: ['12'] },
            { size: 450, wMin: 50.3, wMax: 55.6, kgPerM: 67.66, lengths: ['12'] },
            { size: 500, wMin: 55.8, wMax: 61.6, kgPerM: 83.4, lengths: ['12'] },
            { size: 560, wMin: 62.5, wMax: 69, kgPerM: 104.62, lengths: ['12'] },
        ]
    },
];

/** Pressure class choices shown in the SDR / PN dropdown. */
export const HDPE100_PE_PIPE_GROUPS = HDPE100_PE_PIPE_TABLE.map((group) => group.label);

/** Rows (wall-thickness options) that belong to one pressure class. */
export const getHdpe100Rows = (groupLabel) => {
    const group = HDPE100_PE_PIPE_TABLE.find((item) => item.label === groupLabel);
    return group ? group.rows : [];
};

/** Stable key for one wall-thickness option (nominal size tells them apart). */
export const hdpe100RowKey = (row) => (row ? `${row.size}|${row.wMin}|${row.wMax}` : '');

/** Dropdown label, e.g. "1.8 / 2.2 — Ø 40 mm". */
export const hdpe100RowLabel = (row) =>
    row ? `${row.wMin} / ${row.wMax} — Ø ${row.size} mm` : '';

/** Finds a wall-thickness option by its key. */
export const findHdpe100Row = (groupLabel, key) =>
    getHdpe100Rows(groupLabel).find((row) => hdpe100RowKey(row) === key) || null;

/** Default standard length: the longest one offered for that row. */
export const defaultHdpe100Length = (row) => {
    if (!row || !Array.isArray(row.lengths) || row.lengths.length === 0) return '';
    return row.lengths.reduce((best, item) => (Number(item) > Number(best) ? item : best), row.lengths[0]);
};

/** Weight of one piece (kg) = standard length × kg per metre. */
export const hdpe100PieceWeight = (row, lengthM) => {
    const kgPerM = Number(row?.kgPerM) || 0;
    const length = Number(lengthM) || 0;
    if (!kgPerM || !length) return 0;
    return Math.round(kgPerM * length * 1000000) / 1000000;
};
