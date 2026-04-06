import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// --- HELPERS (Module Level) ---
const drawCheckbox = (doc, x, y, size = 3, isChecked = false) => {
    doc.setLineWidth(0.2);
    doc.rect(x, y, size, size);
    if (isChecked) {
        doc.line(x, y, x + size, y + size);
        doc.line(x, y + size, x + size, y);
    }
};

const drawDigitBoxes = (doc, x, y, boxes, w = 4, h = 6, value = '') => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    for (let i = 0; i < boxes; i++) {
        doc.rect(x + (i * w), y, w, h);
        if (value[i]) {
            doc.text(value[i], x + (i * w) + (w / 2), y + h - 1.5, { align: 'center' });
        }
    }
};

const drawBox = (doc, x, y, w, h, text = '', isBold = false, fontSize = 9, align = 'left', color = [0, 0, 0]) => {
    doc.setDrawColor(0);
    doc.setLineWidth(0.1);
    doc.rect(x, y, w, h);

    if (text) {
        doc.setFont("helvetica", isBold ? "bold" : "normal");
        doc.setFontSize(fontSize);
        doc.setTextColor(...color);

        let textX = x + 1; // padding
        if (align === 'center') textX = x + (w / 2);
        if (align === 'right') textX = x + w - 1;

        const textY = y + (h / 2) + 1;
        doc.text(text, textX, textY, { align: align, maxWidth: w - 2 });
    }
};

const drawFieldBox = (doc, x, y, w, h, label, value, labelIsTop = true) => {
    doc.rect(x, y, w, h);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(0);

    if (labelIsTop) {
        doc.text(label, x + 1, y + 3);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(String(value || '-'), x + (w / 2), y + 7, { align: 'center', maxWidth: w - 2 });
    } else {
        doc.text(label, x + 1, y + 3);
        doc.setFont("helvetica", "normal");
        doc.text(String(value || '-'), x + 1, y + 8, { maxWidth: w - 2 });
    }
};

function convertNumberToWords(amount) {
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const numToWords = (num) => {
        if ((num = num.toString()).length > 9) return 'overflow';
        const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
        if (!n) return;
        let str = '';
        str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
        str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
        str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
        str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
        str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
        return str;
    };

    const main = Math.floor(amount);
    const fils = Math.round((amount - main) * 100);

    let outcome = numToWords(main) + "Dirhams";
    if (fils > 0) outcome += " and " + numToWords(fils) + "Fils";

    return outcome;
}

// Helper to pre-load image and return as Base64/Image
const loadImage = (url) => {
    return new Promise((resolve, reject) => {
        if (!url) {
            reject(new Error("No URL provided"));
            return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous"; // Case-sensitive "anonymous"

        const timeout = setTimeout(() => {
            img.src = ""; // Stop loading
            reject(new Error("Image load timeout: " + url));
        }, 12000); // 12 second timeout (increased for reliability)

        img.onload = () => {
            clearTimeout(timeout);
            resolve(img);
        };
        img.onerror = (e) => {
            clearTimeout(timeout);
            console.error("Failed to load image at:", url, e);
            reject(e);
        };
        img.src = url;
    });
};

export const generateInvoicePDF = async (data, action = 'download', existingDoc = null) => {
    const doc = existingDoc || new jsPDF();
    if (existingDoc) doc.addPage();
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const centerX = pageWidth / 2;

    const colorBlack = [0, 0, 0];
    const printOptions = data.printOptions || {};

    try {
        // --- 1. TITLE & HEADER IMAGE ---
        // --- 1. TITLE & HEADER IMAGE ---
        let titleY = 8;
        let startY = 15;

        if (printOptions.headerImage) {
            try {
                const img = await loadImage(printOptions.headerImage);
                const headerH = 30;
                doc.addImage(img, 'JPEG', margin, 5, contentWidth, headerH);
                // Position title under image
                titleY = 5 + headerH + 8;
                startY = titleY + 7;
            } catch (err) {
                console.warn("Skipping header image due to load error:", err);
            }
        }

        const isPurchase = data.type === 'purchase';

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text(printOptions.selectedHeading || (isPurchase ? "PURCHASE VOUCHER" : "TAX INVOICE"), centerX, titleY, { align: "center" });

        // --- 2. HEADER BLOCK ---
        const headerHeight = 85;
        const midX = 105;
        doc.rect(margin, startY, contentWidth, headerHeight);
        doc.line(midX, startY, midX, startY + headerHeight);

        let y = startY;
        const compH = 30;

        let sNameFontSize = 10;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(sNameFontSize);
        const seller = data.seller || {};
        const sellerName = (seller.name || "AL SAHAM AL AHMAR METALS SCRAP TR.").toUpperCase();
        while (doc.getTextWidth(sellerName) > (midX - margin - 5) && sNameFontSize > 6) {
            sNameFontSize -= 0.5;
            doc.setFontSize(sNameFontSize);
        }
        doc.text(sellerName, margin + 2, y + 5);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const sellerAddress = seller.address || "SAJJA INDUSTRIAL AREA\nSHARJAH, U.A.E\nEmirate: Sharjah";
        const addrLines = sellerAddress.split('\n');
        let addrY = y + 9;
        addrLines.forEach((line, idx) => {
            if (idx < 3) {
                const wrappedAddr = doc.splitTextToSize(line, midX - margin - 7);
                doc.text(wrappedAddr, margin + 5, addrY);
                addrY += 4 * (Array.isArray(wrappedAddr) ? wrappedAddr.length : 1);
            }
        });

        doc.text(`TRN: ${seller.trn || "100350623300003"}`, margin + 5, y + 21);
        doc.text(`E-Mail: ${seller.email || "info@asamplast.com"}`, margin + 5, y + 25);

        y += compH;
        doc.line(margin, y, midX, y);
        doc.setFont("helvetica", "bold");
        doc.text(isPurchase ? "Supplier / Party" : "Consignee", margin + 1, y + 3);
        const consY = y + 7;
        doc.setFontSize(9);
        doc.text(data.partyName || "CASH CUSTOMER", margin + 2, consY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(data.partyAddress || "U.A.E", margin + 2, consY + 4, { maxWidth: 90 });
        doc.text(`TRN: ${data.partyTrn || '-'}`, margin + 2, consY + 12);

        y += 25;
        doc.line(margin, y, midX, y);
        doc.setFont("helvetica", "bold");
        doc.text("Buyer", margin + 1, y + 3);
        const buyY = y + 7;
        doc.setFontSize(9);
        doc.text(data.partyName || "CASH CUSTOMER", margin + 2, buyY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(data.partyAddress || "U.A.E", margin + 2, buyY + 4, { maxWidth: 90 });
        doc.text(`TRN: ${data.partyTrn || '-'}`, margin + 2, buyY + 12);

        // --- RIGHT COLUMN ---
        let ry = startY;
        const rightW = pageWidth - margin - midX;
        const halfRW = rightW / 2;
        const rX1 = midX;
        const rX2 = midX + halfRW;
        const rowH = 12;

        drawFieldBox(doc, rX1, ry, halfRW, rowH, isPurchase ? "Voucher No." : "Invoice No.", data.invoiceNo || "-");
        drawFieldBox(doc, rX2, ry, halfRW, rowH, "Date", data.date || "-");
        ry += rowH;

        drawFieldBox(doc, rX1, ry, halfRW, rowH, "Delivery Note", data.otherRef || "-");
        drawFieldBox(doc, rX2, ry, halfRW, rowH, "Delivery Note Date", data.date || "-");
        ry += rowH;

        drawFieldBox(doc, rX1, ry, halfRW, rowH, "Vehicle No.", data.vehicleNo || "-");
        drawFieldBox(doc, rX2, ry, halfRW, rowH, isPurchase ? "Voucher Date" : "Dated", data.date || "-");
        ry += rowH;

        if (isPurchase && data.supplierInvoiceNo) {
            drawFieldBox(doc, rX1, ry, rightW, rowH, "Supplier Invoice No.", data.supplierInvoiceNo);
            ry += rowH;
        }

        doc.rect(rX1, ry, rightW, rowH * 1.5);
        doc.setFontSize(9);
        doc.text(`P NO : ${data.refNo || '-'}`, rX1 + (rightW / 2), ry + (rowH * 0.75), { align: 'center' });
        ry += (rowH * 1.5);

        drawFieldBox(doc, rX1, ry, halfRW, rowH, "Dispatch Document No.", "");
        drawFieldBox(doc, rX2, ry, halfRW, rowH, "Delivery Note Date", "");
        ry += rowH;

        const containerTextSimple = (data.containers && data.containers.length > 0)
            ? data.containers.map(c => c.containerNo).join(', ')
            : (data.containerNo || "-");

        drawFieldBox(doc, rX1, ry, halfRW, rowH, "Dispatched through", "Container(s): " + containerTextSimple);
        drawFieldBox(doc, rX2, ry, halfRW, rowH, "Destination", data.destination || "JEBEL ALI, DUBAI");
        ry += rowH;

        const remainH = (startY + headerHeight) - ry;
        drawFieldBox(doc, rX1, ry, halfRW, remainH, "Driver Name", data.driverName || "");
        drawFieldBox(doc, rX2, ry, halfRW, remainH, "Driver Contact", data.driverContact || "");

        // --- 3. ITEMS TABLE ---
        const tableY = startY + headerHeight + 2;
        const uSym = data.baseUnitSymbol || "KGS";
        const headers = [["Sl.No", "Description of Goods", `Quantity\n(${uSym})`, "Rate", "Per", "Amount\n(AED)"]];
        const body = data.items.map((item, i) => [
            i + 1,
            `${item.productName}\n${item.description || ''}`,
            Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            Number(item.rate).toFixed(3),
            uSym,
            Number(item.total).toLocaleString('en-US', { minimumFractionDigits: 2 })
        ]);

        if (data.taxAmount > 0) {
            body.push(["", `VAT @ ${data.taxPercent}%`, "", `${data.taxPercent}%`, "", Number(data.taxAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })]);
            body.push(["", "", "", "", "", ""]);
        }

        const packingText = data.packing || (data.bags ? `${data.bags} BAGS` : "LOOSE DETAILS");

        let containerSealText = "";
        if (data.containers && data.containers.length > 0) {
            containerSealText = data.containers.map(c => `CONTAINER: ${c.containerNo || '-'} / SEAL: ${c.sealNo || '-'}`).join('\n');
        } else {
            containerSealText = (data.containerNo ? `CONTAINER: ${data.containerNo}` : "") + (data.sealNo ? ` / SEAL: ${data.sealNo}` : "");
        }

        const originText = data.origin || "COUNTRY OF ORIGIN U.A.E";
        body.push(["", `${packingText}\n${originText}${containerSealText ? `\n${containerSealText}` : ""}`, "", "", "", ""]);

        const totalQty = data.items.reduce((s, i) => s + Number(i.quantity || 0), 0);
        const grandTotal = Number(data.grandTotalForeign || 0);

        autoTable(doc, {
            startY: tableY,
            head: headers,
            body: body,
            theme: 'plain',
            tableWidth: contentWidth,
            margin: { left: margin },
            styles: { fontSize: 9, cellPadding: 3, lineColor: 0, lineWidth: 0.1, valign: 'middle', textColor: 0, font: "helvetica" },
            headStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'center', lineWidth: 0.1, lineColor: 0 },
            columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 80 }, 2: { cellWidth: 25, halign: 'right' }, 3: { cellWidth: 20, halign: 'right' }, 4: { cellWidth: 15, halign: 'center' }, 5: { cellWidth: 38, halign: 'right' } },
            foot: [["", "TOTAL", totalQty.toLocaleString('en-US', { minimumFractionDigits: 2 }), "", "", grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })]],
            footStyles: { fontStyle: 'bold', halign: 'right', fillColor: [255, 255, 255], textColor: 0, lineWidth: 0.1, lineColor: 0 },
            didParseCell: (data) => { if (data.section === 'foot' && data.column.index === 1) data.cell.styles.halign = 'center'; }
        });

        let finalY = doc.lastAutoTable.finalY;
        if (finalY > 230) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        const amtY = finalY + 5;
        doc.text("Amount Chargeable (inwards)", margin + 2, amtY);
        doc.text(`${convertNumberToWords(grandTotal)} Only.`, margin + 2, amtY + 5);
        doc.text("E.&O.E", pageWidth - margin - 2, amtY, { align: 'right' });

        if (data.taxAmount > 0) {
            const taxTableY = amtY + 15;
            const taxTableW = 100;
            const taxTableX = pageWidth - margin - taxTableW;
            doc.setLineWidth(0.1);
            doc.line(taxTableX, taxTableY, pageWidth - margin, taxTableY);
            doc.text("VAT %", taxTableX + 5, taxTableY + 4);
            doc.text("Assessable Value", taxTableX + 35, taxTableY + 4);
            doc.text("Tax Amount", taxTableX + 75, taxTableY + 4);
            doc.line(taxTableX, taxTableY + 6, pageWidth - margin, taxTableY + 6);
            doc.setFont("helvetica", "normal");
            doc.text(`${data.taxPercent}%`, taxTableX + 5, taxTableY + 10);
            doc.text(Number(data.itemsTotal).toFixed(2), taxTableX + 55, taxTableY + 10, { align: 'right' });
            doc.text(Number(data.taxAmount).toFixed(2), pageWidth - margin - 2, taxTableY + 10, { align: 'right' });
            doc.line(taxTableX, taxTableY + 12, pageWidth - margin, taxTableY + 12);
            doc.setFont("helvetica", "bold");
            doc.text("Total", taxTableX + 5, taxTableY + 16);
            doc.text(Number(data.itemsTotal).toFixed(2), taxTableX + 55, taxTableY + 16, { align: 'right' });
            doc.text(Number(data.taxAmount).toFixed(2), pageWidth - margin - 2, taxTableY + 16, { align: 'right' });
            doc.line(taxTableX, taxTableY + 18, pageWidth - margin, taxTableY + 18);
        }

        const declY = Math.max(finalY + 45, 240);
        const bank = data.companyBank || data.bankDetails;
        if (bank) {
            const bankY = declY - 25;
            doc.setFontSize(8);
            doc.text("Bank Details for Payment:", margin + 2, bankY);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);
            
            const bankInfo = [
                `Bank Name: ${bank.bankName || '-'}`,
                `Account Name: ${bank.accTitle || bank.bankTitle || (data.seller && data.seller.name) || '-'}`,
                `Account No: ${bank.accNumber || '-'}`,
                `IBAN: ${bank.iban || '-'}`,
                (bank.swift || bank.swiftCode) ? `Swift Code: ${bank.swift || bank.swiftCode}` : null
            ].filter(Boolean);

            bankInfo.forEach((line, idx) => {
                doc.text(line, margin + 2, bankY + 4 + (idx * 3.5));
            });
        }

        doc.setFont("helvetica", "bold");
        doc.text("Declaration", margin + 2, declY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("We declare that this invoice shows the actual price of the", margin + 2, declY + 4);
        doc.text("goods described and that all particulars are true and", margin + 2, declY + 8);
        doc.text("correct.", margin + 2, declY + 12);

        const sigBoxX = midX + 10;
        const sigBoxW = rightW - 10;
        const sigBoxH = 35;
        doc.rect(sigBoxX, declY - 2, sigBoxW, sigBoxH);
        doc.text(`for ${sellerName}`, sigBoxX + 2, declY + 2);

        if (printOptions.signatureImage) {
            try {
                const img = await loadImage(printOptions.signatureImage);
                doc.addImage(img, 'PNG', sigBoxX + (sigBoxW / 2) - 15, declY + 5, 30, 15);
            } catch (err) { console.error("Sig Image Error:", err); }
        }

        if (printOptions.stampImage) {
            try {
                const img = await loadImage(printOptions.stampImage);
                // Use scale factor if provided, else 1.0
                const scale = Number(printOptions.stampScale) || 1.0;
                const baseW = 25;
                const baseH = 20;
                doc.addImage(img, 'PNG', sigBoxX + 5, declY + 8, baseW * scale, baseH * scale);
            } catch (err) { console.error("Stamp Image Error:", err); }
        }

        doc.setFont("helvetica", "bold");
        doc.text("Authorized Signatory", pageWidth - margin - 2, declY + 30, { align: 'right' });
        doc.setFontSize(6);
        doc.setFont("helvetica", "normal");
        doc.text("This is a Computer-Generated Invoice", centerX, pageHeight - 5, { align: 'center' });

        if (action === 'preview') {
            window.open(doc.output('bloburl'), '_blank');
        } else if (action === 'return') {
            return doc;
        } else {
            doc.save(`Invoice_${data.invoiceNo || 'Draft'}.pdf`);
        }
    } catch (globalErr) {
        console.error("Global PDF Error:", globalErr);
        alert("Critical Error Generating PDF: " + globalErr.message);
    }
};

export const generatePackingListPDF = async (data, action = 'download', existingDoc = null) => {
    const doc = existingDoc || new jsPDF();
    if (existingDoc) doc.addPage();
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const centerX = pageWidth / 2;
    const printOptions = data.printOptions || {};

    try {
        let titleY = 12;
        let startY = 20;

        if (printOptions.headerImage) {
            try {
                const img = await loadImage(printOptions.headerImage);
                const headerH = 30;
                doc.addImage(img, 'JPEG', margin, 5, contentWidth, headerH);
                titleY = 5 + headerH + 10;
                startY = titleY + 8;
            } catch (err) { console.warn("Header Error:", err); }
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("PACKING LIST", centerX, titleY, { align: "center" });

        // --- Layout Constants ---
        const col1X = margin;
        const col2X = 105;
        const colW = (pageWidth / 2) - margin;
        let y = startY;

        // --- ROW 1: SELLER & DETAILS ---
        const row1H = 45;
        // Seller Box
        doc.setFontSize(8);
        doc.rect(col1X, y, colW, row1H);
        doc.setFillColor(240, 240, 240);
        doc.rect(col1X, y, colW, 5, 'F');
        doc.rect(col1X, y, colW, 5);
        doc.text("SELLER :", col1X + 2, y + 3.5);

        const seller = data.seller || {};
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(seller.name || "COMPANY NAME", col1X + 2, y + 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("COMPANY ADDRESS:", col1X + 2, y + 14);
        doc.text(seller.address || "", col1X + 2, y + 18, { maxWidth: colW - 4 });
        doc.text(`TRN : ${seller.trn || "-"}`, col1X + 2, y + 35);
        doc.text(`Email : ${seller.email || "-"}`, col1X + 2, y + 39);
        doc.text(`MOBILE : ${seller.phone || "-"}`, col1X + 2, y + 43);

        // Details Box
        doc.rect(col2X, y, colW, row1H);
        doc.rect(col2X, y, colW, 5, 'F');
        doc.rect(col2X, y, colW, 5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("DETAILS :", col2X + 2, y + 3.5);

        const detailsData = [
            ["INVOICE NO", data.invoiceNo],
            ["INVOICE DATE", data.date],
            ["PI NO AND DATE", data.otherRef],
            ["BUYERS ORDER DATE", data.date],
            ["BUYERS ORDER NO", data.refNo],
            ["QUOTE NO", ""],
            ["OTHER REFERENCE", ""]
        ];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        detailsData.forEach((row, i) => {
            doc.text(row[0], col2X + 2, y + 10 + (i * 5));
            doc.text(String(row[1] || "-"), col2X + colW - 2, y + 10 + (i * 5), { align: 'right' });
        });

        y += row1H + 2;

        // --- ROW 2: CONSIGNEE & BUYER ---
        const row2H = 45;
        // Consignee
        doc.rect(col1X, y, colW, row2H);
        doc.rect(col1X, y, colW, 5, 'F');
        doc.rect(col1X, y, colW, 5);
        doc.setFont("helvetica", "bold");
        doc.text("CONSIGNEE :", col1X + 2, y + 3.5);
        doc.text(data.consigneeName || data.partyName || "", col1X + 2, y + 10);
        doc.setFont("helvetica", "normal");
        doc.text("COMPANY ADDRESS:", col1X + 2, y + 14);
        doc.text(data.consigneeAddress || data.partyAddress || "", col1X + 2, y + 18, { maxWidth: colW - 4 });

        // Buyer
        doc.rect(col2X, y, colW, row2H);
        doc.rect(col2X, y, colW, 5, 'F');
        doc.rect(col2X, y, colW, 5);
        doc.setFont("helvetica", "bold");
        doc.text("BUYER :", col2X + 2, y + 3.5);
        doc.text(data.buyerName || data.partyName || "", col2X + 2, y + 10);
        doc.setFont("helvetica", "normal");
        doc.text("COMPANY ADDRESS:", col2X + 2, y + 14);
        doc.text(data.buyerAddress || data.partyAddress || "", col2X + 2, y + 18, { maxWidth: colW - 4 });

        y += row2H + 2;

        // --- ROW 3: SHIPPING FIELDS ---
        const shipH = 8;
        const drawShipBox = (x, y, label, value) => {
            doc.rect(x, y, colW, shipH);
            doc.rect(x, y, colW, 4, 'F');
            doc.rect(x, y, colW, 4);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.text(label, x + 2, y + 3);
            doc.setFont("helvetica", "normal");
            doc.text(String(value || "-"), x + 2, y + 7);
        };

        drawShipBox(col1X, y, "COUNTRY OF ORIGIN (GOODS)", data.countryOfOrigin);
        drawShipBox(col2X, y, "COUNTRY OF FINAL DESTINATION", data.finalDestination);
        y += shipH + 2;
        drawShipBox(col1X, y, "PORT OF LOADING", data.portOfLoading);
        drawShipBox(col2X, y, "PORT OF DISCHARGE", data.portOfDischarge);
        y += shipH + 2;
        drawShipBox(col1X, y, "VESSEL NAME", data.vesselName);
        drawShipBox(col2X, y, "VOYAGE NO.", data.voyageNo);
        y += shipH + 4;

        // --- ITEMS TABLE ---
        const tableHeaders = [["SR.NO", "CONTAINER & \nSEAL NO.", "TYPE OF \nPACKING", "DESCRIPTION \nOF GOODS", "QUANTITY \n(MTS)"]];
        const tableBody = data.items.map((item, i) => {
            const qty = Number(item.quantity || 0);
            const tare = 0.250; // Manual sample tare for the MTS display
            const gross = qty + tare;

            return [
                i + 1,
                (data.containers && data.containers.length > 0)
                    ? data.containers.map(c => `${c.containerNo || ''}${c.sealNo ? ` / SEAL: ${c.sealNo}` : ''}`).join('\n')
                    : (data.containerNo || "") + (data.sealNo ? `\nSEAL NO: ${data.sealNo}` : ""),
                data.packingType === 'loose' ? 'LOOSE' : 'JUMBO BAGS',
                `${item.productName}\n${item.description || ""}`,
                `${gross.toFixed(3)} GROSS WEIGHT\n${tare.toFixed(3)} TARE WEIGHT\n${qty.toFixed(3)} NET WEIGHT`
            ];
        });

        autoTable(doc, {
            startY: y,
            head: tableHeaders,
            body: tableBody,
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 2, lineColor: 0, lineWidth: 0.1, valign: 'middle', font: "helvetica", textColor: 0 },
            headStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'center', lineWidth: 0.1, lineColor: 0 },
            columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 35 }, 2: { cellWidth: 35 }, 3: { cellWidth: 60 }, 4: { cellWidth: 48, halign: 'right' } },
            foot: [["", "", "TOTAL", "", `${data.items.reduce((s, i) => s + Number(i.quantity), 0).toFixed(3)} NET MTS`]],
            footStyles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240], textColor: 0, lineWidth: 0.1, lineColor: 0 }
        });

        let finalY = doc.lastAutoTable.finalY + 10;
        if (finalY > 260) { doc.addPage(); finalY = 20; }

        doc.setFont("helvetica", "bold");
        doc.text(`for ${seller.name || "COMPANY NAME"}`, pageWidth - margin - 2, finalY, { align: 'right' });

        if (printOptions.stampImage) {
            try {
                const img = await loadImage(printOptions.stampImage);
                const scale = Number(printOptions.stampScale) || 1.0;
                doc.addImage(img, 'PNG', pageWidth - margin - 50, finalY + 5, 25 * scale, 20 * scale);
            } catch (e) { }
        }
        if (printOptions.signatureImage) {
            try {
                const img = await loadImage(printOptions.signatureImage);
                doc.addImage(img, 'PNG', pageWidth - margin - 40, finalY + 5, 30, 15);
            } catch (e) { }
        }

        doc.text("Authorized Signatory", pageWidth - margin - 2, finalY + 30, { align: 'right' });

        if (action === 'preview') {
            window.open(doc.output('bloburl'), '_blank');
        } else if (action === 'return') {
            return doc;
        } else {
            doc.save(`PackingList_${data.invoiceNo || 'Draft'}.pdf`);
        }

    } catch (err) {
        console.error("Packing List PDF Error:", err);
        alert("Error: " + err.message);
    }
};

export const generateBillOfExchangePDF = async (data, action = 'download', existingDoc = null) => {
    const doc = existingDoc || new jsPDF();
    if (existingDoc) doc.addPage();
    const pageWidth = 210;
    const margin = 20;
    const centerX = pageWidth / 2;
    const seller = data.seller || {};
    const amount = Number(data.grandTotalForeign || 0);

    try {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("BILL OF EXCHANGE", centerX, 30, { align: "center" });
        doc.setLineWidth(0.5);
        doc.line(centerX - 25, 31, centerX + 25, 31);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        let y = 50;

        doc.text(`INV NO. ${data.invoiceNo || 'DRAFT'}`, margin, y);
        y += 10;
        doc.text(`For: ${amount.toFixed(2)} ${data.currencySymbol || 'AED'}`, margin, y);
        y += 20;

        const words = convertNumberToWords(amount).toUpperCase().split('DIRHAMS')[0].trim();
        const filsPart = convertNumberToWords(amount).toUpperCase().split('DIRHAMS')[1]?.replace('AND', '').replace('FILS', '').trim() || 'ZERO';

        // Exact format from image: DIRHAMS: [WORDS] AND [FILS] FILS AED ONLY
        const combinedWords = `DIRHAMS: ${words} AND ${filsPart} FILS ${data.currencySymbol || 'AED'} ONLY`;

        const tenor = data.boeTenor || '90 DAYS D/A';
        const bank = data.boeBank || 'HABIB BANK AG ZURICH';

        const mainText = `At ${tenor} of First Bill of Exchange (First of the same Tenor and date being unpaid) pay to ${bank} or order the sum of ${combinedWords}`;

        doc.text(mainText, margin, y, { maxWidth: pageWidth - (margin * 2), lineHeightFactor: 1.5 });
        y += 25;

        doc.text(`Drawn Under ${seller.name || 'COMPANY NAME'}`, margin, y);
        y += 15;

        doc.setFont("helvetica", "bold");
        doc.text("To:", margin, y);
        y += 8;
        doc.setFont("helvetica", "normal");
        doc.text(data.buyerName || data.partyName || "", margin, y);
        y += 6;
        doc.text(data.buyerAddress || data.partyAddress || "", margin, y, { maxWidth: pageWidth - (margin * 2) });

        if (action === 'preview') {
            window.open(doc.output('bloburl'), '_blank');
        } else if (action === 'return') {
            return doc;
        } else {
            doc.save(`BillOfExchange_${data.invoiceNo || 'Draft'}.pdf`);
        }
    } catch (err) {
        console.error("BOE PDF Error:", err);
        alert("Error: " + err.message);
    }
};

export const generateBankApplicationPDF = async (data, action = 'download', existingDoc = null) => {
    const doc = existingDoc || new jsPDF();
    if (existingDoc) doc.addPage();
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const centerX = pageWidth / 2;
    const seller = data.seller || {};
    const printOptions = data.printOptions || {};
    const hbz = data.hbzOptions || {};

    const GREEN = [34, 139, 34]; // Forest Green
    const DARK_BLUE = [0, 0, 128]; // For labels if needed

    try {
        let y = 10;

        // 1. DATE SECTION
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Date", margin, y + 4);

        const dateParts = (data.date || '').split('-'); // YYYY-MM-DD
        const d_val = dateParts[2] || '02';
        const m_val = dateParts[1] || '02';
        const y_val = dateParts[0] || '2026';

        // Draw date boxes with labels
        const dateDigitW = 7;
        const dateDigitH = 6;
        let dx = margin + 10;

        // Day
        drawDigitBoxes(doc, dx, y, 2, dateDigitW, dateDigitH, d_val);
        doc.setFontSize(6);
        doc.text("day", dx + 2, y + 7.5);
        dx += (2 * dateDigitW) + 2;

        // Month
        drawDigitBoxes(doc, dx, y, 2, dateDigitW, dateDigitH, m_val);
        doc.text("month", dx + 2, y + 7.5);
        dx += (2 * dateDigitW) + 2;

        // Year
        drawDigitBoxes(doc, dx, y, 4, dateDigitW, dateDigitH, y_val);
        doc.text("year", dx + 2, y + 7.5);

        y += 12;

        // 2. BRANCH SECTION
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const branchName = data.bankBranch || 'AL QUSAIS';
        doc.text(branchName, margin, y);
        const branchW = doc.getTextWidth(branchName);
        doc.line(margin, y + 0.5, margin + 45, y + 0.5);
        doc.setFont("helvetica", "normal");
        doc.text("Branch,", margin + 47, y);

        y += 5;
        doc.text("United Arab Emirates.", margin, y);

        y += 10;

        // 3. CUSTOMER REFERENCE SECTION
        doc.setDrawColor(...GREEN);
        doc.setLineWidth(0.4);
        const sectionTitle = "CUSTOMER REFERENCE";
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...GREEN);
        const sTitleW = doc.getTextWidth(sectionTitle);
        doc.line(margin, y - 1, margin + (contentWidth / 2) - (sTitleW / 2) - 5, y - 1);
        doc.text(sectionTitle, (pageWidth / 2) - (sTitleW / 2), y);
        doc.line((pageWidth / 2) + (sTitleW / 2) + 5, y - 1, pageWidth - margin, y - 1);

        y += 3;
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.rect(margin, y, contentWidth, 48);

        doc.setTextColor(0);
        doc.setFontSize(8);
        let sy = y + 5;

        // Mail to
        doc.setFont("helvetica", "normal");
        doc.text("Mail to", margin + 2, sy);
        doc.setFontSize(6);
        doc.text("(Bank name & address)", margin + 12, sy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const bankAddr = (data.companyBank)
            ? `${data.companyBank.bankName}\n${data.companyBank.branch || ''} ${data.companyBank.city || ''} ${data.companyBank.country || ''}`.trim()
            : (data.boeBank || data.bankMailTo || "Habib Metropolitan Bank Ltd.\nShahrah-e-Liaquat Branch, Karachi, Pakistan");
        doc.text(bankAddr, margin + 45, sy, { maxWidth: contentWidth - 48 });
        doc.line(margin + 45, sy + 1, margin + contentWidth - 2, sy + 1);
        doc.line(margin + 45, sy + 6, margin + contentWidth - 2, sy + 6);

        sy += 12;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Drawee", margin + 2, sy);
        doc.setFontSize(6);
        doc.text("(LC applicant)/Drawn on", margin + 13, sy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const drawee = data.buyerName || data.partyName || "SAQI INDUSTRIES (SMC) PRIVET LTD";
        doc.text(drawee, margin + 45, sy);
        doc.line(margin + 45, sy + 1, margin + contentWidth - 2, sy + 1);

        sy += 10;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Drawer", margin + 2, sy);
        doc.setFontSize(6);
        doc.text("(Beneficiary) name", margin + 13, sy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const drawer = (data.companyBank && data.companyBank.accTitle)
            ? data.companyBank.accTitle
            : (seller.name || "AL SAHAM AL AHMAR METALS SCRAP TR");
        doc.text(drawer, margin + 45, sy);
        doc.line(margin + 45, sy + 1, margin + contentWidth - 2, sy + 1);

        sy += 10;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Drawer", margin + 2, sy);
        doc.setFontSize(6);
        doc.text("(Beneficiary) account number", margin + 13, sy);

        const rawAcc = (data.companyBank && data.companyBank.accNumber)
            ? data.companyBank.accNumber
            : (data.bankBeneficiaryAcc || "0201111203111050113988");
        const accNoFromData = rawAcc.replace(/\D/g, '');
        const dispAcc = accNoFromData.slice(0, 22).padStart(22, '0'); // Ensure 22 digits max/pad or trim
        drawDigitBoxes(doc, margin + 60, sy - 4, 22, 5.5, 6, dispAcc);
        doc.setFontSize(6);
        doc.text("22 digits", margin + 60, sy + 4);

        sy += 8;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Your reference", margin + 2, sy);
        doc.setFontSize(6);
        doc.text("(Invoice number)", margin + 22, sy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const refNo = data.invoiceNo || "BD1505CO1605MDSPN";
        doc.rect(margin + contentWidth - 75, sy - 4, 73, 6.5);
        doc.text(refNo, margin + contentWidth - 73, sy + 1);

        y += 55;

        // 4. COMMODITY & SHIPMENT INFO
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("Commodity", margin, y);
        doc.setFont("helvetica", "bold underline");
        const itemNames = (data.items || []).map(i => i.productName).filter(Boolean).join(', ');
        const commodity = itemNames || data.bankCommodity || "PRINTED PLASTICS AND OTHER GOODS TO DECLARE";
        doc.text(commodity, margin + 17, y, { maxWidth: contentWidth - 95 });

        doc.setFont("helvetica", "normal");
        doc.text("Mode of shipment", margin + 132, y);
        drawCheckbox(doc, margin + 158, y - 2.5, 3, true);
        doc.setFontSize(7); doc.text("Sea", margin + 162, y);
        drawCheckbox(doc, margin + 170, y - 2.5, 3, false); doc.text("Air", margin + 174, y);
        drawCheckbox(doc, margin + 180, y - 2.5, 3, false); doc.text("Road", margin + 184, y);

        y += 8;
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("Shipment from", margin, y);
        doc.setFont("helvetica", "bold underline");
        doc.text(data.portOfLoading || "SPAIN", margin + 25, y);

        doc.setFont("helvetica", "normal");
        doc.text("Shipment to", margin + 78, y);
        doc.setFont("helvetica", "bold underline");
        doc.text(data.portOfDischarge || "KARACHI PAKISTAN", margin + 98, y);

        doc.setFont("helvetica", "normal");
        doc.text("Tenor", margin + 155, y);
        doc.setFont("helvetica", "bold");
        doc.rect(margin + 165, y - 4, contentWidth - 155, 6);
        doc.text(data.boeTenor || "D/A 90 DAYS", margin + 167, y);

        y += 8;
        doc.setFont("helvetica", "normal");
        doc.text("Bill amount", margin, y);
        doc.setFont("helvetica", "bold");
        doc.rect(margin + 18, y - 4, 52, 6);
        doc.text(`${Number(data.grandTotalForeign || 0).toFixed(2)} ${data.currencySymbol || 'AED'}`, margin + 20, y);

        doc.setFont("helvetica", "normal");
        doc.text("Other Charges", margin + 75, y);
        doc.line(margin + 98, y + 0.5, margin + 140, y + 0.5);

        doc.setFont("helvetica", "normal");
        doc.text("Total amount", margin + 145, y);
        doc.setFont("helvetica", "bold");
        doc.rect(margin + 165, y - 4, contentWidth - 155, 6);
        doc.text(`${Number(data.grandTotalForeign || 0).toFixed(2)} ${data.currencySymbol || 'AED'}`, margin + 167, y);

        y += 10;

        // 5. ENCLOSED DOCUMENTS SECTION
        const drawEnclosedBox = (startY, title, showCheckboxes = true) => {
            doc.setDrawColor(...GREEN);
            doc.setLineWidth(0.4);
            doc.rect(margin, startY, contentWidth, title === "ENCLOSED DOCUMENTS UNDER COLLECTION" ? 38 : 34);

            // Section Title with separator
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(...GREEN);
            const fullTitle = title + " (check the document(s) enclosed)";
            const tW = doc.getTextWidth(fullTitle);

            doc.setFillColor(255);
            doc.rect(margin + 5, startY - 2, tW + 4, 4, 'F');
            drawCheckbox(doc, margin + 2, startY - 1.5, 3, false);
            doc.text(fullTitle, margin + 7, startY + 1);

            doc.setTextColor(0);
            return startY + 8;
        };

        // COLLECTION BOX
        let colY = drawEnclosedBox(y, "ENCLOSED DOCUMENTS UNDER COLLECTION");
        doc.setFontSize(8);
        const releaseAny = hbz.releaseAgainstPayment || hbz.releaseAgainstAcceptance || hbz.releaseAgainstAvalised || hbz.releaseAgainstOthers;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, releaseAny);
        doc.setFont("helvetica", "bold");
        doc.text("Release documents against", margin + 7, colY);
        doc.setFont("helvetica", "normal");
        drawCheckbox(doc, margin + 48, colY - 2.5, 3, hbz.releaseAgainstPayment || false); doc.text("Payment", margin + 53, colY);
        drawCheckbox(doc, margin + 68, colY - 2.5, 3, hbz.releaseAgainstAcceptance || false); doc.text("Acceptance", margin + 73, colY);
        drawCheckbox(doc, margin + 92, colY - 2.5, 3, hbz.releaseAgainstAvalised || false); doc.text("Avalised", margin + 97, colY);
        drawCheckbox(doc, margin + 115, colY - 2.5, 3, hbz.releaseAgainstOthers || false); doc.text("Others", margin + 120, colY);
        doc.setFont("helvetica", "bold");
        const othersText = hbz.releaseAgainstOthersText || "";
        doc.text(othersText, margin + 132, colY);
        doc.line(margin + 132, colY + 1, margin + contentWidth - 2, colY + 1);

        colY += 6;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, hbz.chargesOnDrawee || false); doc.text("All your charges on Drawee's account.", margin + 7, colY);
        colY += 5;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, hbz.protestNonPayment || false); doc.text("Protest for non-acceptance and/or non payment.", margin + 7, colY);
        colY += 5;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, hbz.doNotProtest || false); doc.text("Do not protest.", margin + 7, colY);
        colY += 5;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, hbz.doNotWaiveCharges || false); doc.text("Do not waive collection charges if refused.", margin + 7, colY);
        colY += 5;
        const ourCharges = hbz.ourChargesText || "____________________________";
        // Check if ourCharges has value, if so tick checkbox? User didn't ask for checkbox for this line, but the line has a checkbox in previous code?
        // Let's check previous code. Line 893: drawCheckbox(doc, margin + 2, colY - 2.5, 3, false);
        // The prompt says "Our charges of ... to be collected".
        // Use a heuristic: if text is entered, tick the box.
        const hasOurCharges = !!hbz.ourChargesText;
        drawCheckbox(doc, margin + 2, colY - 2.5, 3, hasOurCharges);
        doc.text(`Our charges of ${ourCharges} to be collected from drawee plus your charges.`, margin + 7, colY);

        y += 45;

        // LETTER OF CREDIT BOX
        let lcY = drawEnclosedBox(y, "ENCLOSED DOCUMENTS UNDER LETTER OF CREDIT");
        doc.setFontSize(8);
        drawCheckbox(doc, margin + 2, lcY - 2.5, 3, false);
        doc.text("Letter of credit number", margin + 7, lcY);
        doc.rect(margin + 42, lcY - 4, 48, 6);

        lcY += 6;
        drawCheckbox(doc, margin + 2, lcY - 2.5, 3, false); doc.text("Original LC enclosed.", margin + 7, lcY);
        lcY += 5;
        drawCheckbox(doc, margin + 2, lcY - 2.5, 3, false); doc.text("Original LC retained by the Bank.", margin + 7, lcY);
        lcY += 5;
        drawCheckbox(doc, margin + 2, lcY - 2.5, 3, false);
        doc.text("In accordance with the Uniform Customs and Practice for Documentary Credits currently prevailing, we confirm that all", margin + 7, lcY);
        lcY += 4;
        doc.text("amendments are accepted (if any).", margin + 7, lcY);

        y += 42;

        // 6. BOTTOM DETAILS
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("Please mark the number of documents attached", margin, y);
        doc.setFont("helvetica", "bold underline");
        doc.text(hbz.attachmentsSummary || data.bankAttachments || "BL ORIGINAL 3,COPY 3,INVOICE 3, PAKISNG LIST 3", margin + 72, y);

        y += 8;
        doc.setFont("helvetica", "normal");
        doc.text("Draft at", margin, y);
        drawCheckbox(doc, margin + 14, y - 2.5, 3, hbz.draftSight || false); doc.text("Sight", margin + 18, y);
        drawCheckbox(doc, margin + 28, y - 2.5, 3, hbz.draftUsance || false); doc.text("Usance", margin + 32, y);
        doc.line(margin + 45, y + 0.5, margin + 120, y + 0.5);

        doc.text("Visa Inv :", margin + 125, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.visaInv || "", margin + 140, y); doc.setFont("helvetica", "normal");
        doc.line(margin + 140, y + 0.5, margin + 185, y + 0.5);

        doc.text("Others :", margin + 188, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.other1 || "", margin + 200, y); doc.setFont("helvetica", "normal");

        y += 6;
        doc.text("B/L or AWB :", margin, y);
        drawCheckbox(doc, margin + 20, y - 2.5, 3, hbz.blOriginal || false); doc.text("Original", margin + 24, y);
        drawCheckbox(doc, margin + 38, y - 2.5, 3, hbz.blNonNegotiable || false); doc.text("Non Negotiable", margin + 42, y);
        doc.line(margin + 65, y + 0.5, margin + 120, y + 0.5);

        doc.text("P/L         :", margin + 125, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.packingList || "", margin + 140, y); doc.setFont("helvetica", "normal");
        doc.line(margin + 140, y + 0.5, margin + 185, y + 0.5);

        doc.text("Others :", margin + 188, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.other2 || "", margin + 200, y); doc.setFont("helvetica", "normal");

        y += 6;
        doc.text("Invoice      :", margin, y);
        doc.setFont("helvetica", "bold");
        doc.text(data.invoiceNo || "BD1505CO1605MDSPN", margin + 20, y);
        doc.line(margin + 20, y + 0.5, margin + 120, y + 0.5);
        doc.setFont("helvetica", "normal");

        doc.text("C/O        :", margin + 125, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.certificateOrigin || "", margin + 140, y); doc.setFont("helvetica", "normal");
        doc.line(margin + 140, y + 0.5, margin + 185, y + 0.5);

        doc.text("Others :", margin + 188, y);
        doc.setFont("helvetica", "bold"); doc.text(hbz.other3 || "", margin + 200, y); doc.setFont("helvetica", "normal");

        y += 12;
        doc.setFontSize(8);
        doc.text("Kindly credit the proceeds to our above mentioned account after deduction of your charges. By signing below, I/we accept the", margin, y);
        y += 4;
        doc.text("Terms and Conditions applicable to this product.", margin, y);

        // 7. SIGNATURE SECTION
        y += 10;
        doc.setLineWidth(0.2);
        const sigLineY = y + 15;
        doc.line(margin, sigLineY, margin + 45, sigLineY);
        doc.line(margin + 55, sigLineY, margin + 100, sigLineY);
        doc.line(margin + 110, sigLineY, margin + 130, sigLineY);

        doc.setFontSize(6);
        doc.text("authorized signatory(s)", margin, sigLineY + 3);

        // Stamp and Signature Images
        if (printOptions.stampImage || printOptions.signatureImage) {
            const scale = printOptions.stampScale || 1;
            const size = 30 * scale;
            const imgX = margin + 5;
            const imgY = sigLineY - size + 2;

            if (printOptions.signatureImage) {
                try {
                    const sigImg = await loadImage(printOptions.signatureImage);
                    doc.addImage(sigImg, 'PNG', imgX, imgY, size, size);
                } catch (e) { console.warn("Sig fail", e); }
            }
            if (printOptions.stampImage) {
                try {
                    const stampImg = await loadImage(printOptions.stampImage);
                    doc.addImage(stampImg, 'PNG', imgX, imgY, size, size);
                } catch (e) { console.warn("Stamp fail", e); }
            }
        }

        // OFFICE USE BOX
        doc.setDrawColor(...GREEN);
        doc.setLineWidth(0.4);
        doc.rect(margin + 140, sigLineY - 14, contentWidth - 140, 16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...GREEN);
        const offTitle = "FOR OFFICE USE";
        const offW = doc.getTextWidth(offTitle);
        doc.setFillColor(255);
        doc.rect(margin + 140 + 2, sigLineY - 16, offW + 4, 4, 'F');
        doc.text(offTitle, margin + 140 + 4, sigLineY - 13);

        doc.setTextColor(150);
        doc.rect(margin + contentWidth - 10, sigLineY - 11, 8, 8, 'D');
        doc.setFontSize(10);
        doc.text("SV", margin + contentWidth - 8.5, sigLineY - 4.5);

        doc.setFontSize(6);
        doc.setTextColor(0);
        doc.text("signature", margin + 142, sigLineY - 1);
        doc.text("Verified by ____________________", margin + 142, sigLineY + 3);

        // FOOTER
        doc.setFillColor(...GREEN);
        doc.rect(0, 290, pageWidth, 7, 'F');
        doc.setTextColor(255);
        doc.setFontSize(10);
        doc.setFont("courier", "bold");
        doc.text("TF03JUN21/IBUAE | Page 1/1", pageWidth - margin, 294.5, { align: 'right' });

        if (action === 'preview') {
            window.open(doc.output('bloburl'), '_blank');
        } else if (action === 'return') {
            return doc;
        } else {
            doc.save(`BankApplication_${data.invoiceNo || 'Draft'}.pdf`);
        }

    } catch (err) {
        console.error("Bank Form Error:", err);
        alert("Error: " + err.message);
    }
};

export const generateSelectedDocsPDF = async (data, action = 'download') => {
    const selected = data.printOptions?.selectedDocs || ['invoice'];
    if (selected.length === 0) {
        alert("Please select at least one document.");
        return;
    }

    // Sort to ensure a logical order: Invoice -> Packing List -> BOE -> Bank Form
    const order = ['invoice', 'packing_list', 'bill_of_exchange', 'bank_application'];

    // Sort logic: if objects, sort by templateId's position in order array
    const sorted = [...selected].sort((a, b) => {
        const idA = typeof a === 'string' ? a : a.templateId;
        const idB = typeof b === 'string' ? b : b.templateId;
        return order.indexOf(idA) - order.indexOf(idB);
    });

    let combinedDoc = null;

    try {
        for (const docItem of sorted) {
            const type = typeof docItem === 'string' ? docItem : docItem.templateId;
            const customName = typeof docItem === 'string' ? null : docItem.name;

            // Create a local copy of data to set the specific heading for this doc
            const docData = {
                ...data,
                printOptions: {
                    ...data.printOptions,
                    selectedHeading: customName || data.printOptions?.selectedHeading || (type === 'invoice' ? 'INVOICE' : type.replace('_', ' ').toUpperCase())
                }
            };

            if (type === 'invoice') {
                combinedDoc = await generateInvoicePDF(docData, 'return', combinedDoc);
            } else if (type === 'packing_list') {
                combinedDoc = await generatePackingListPDF(docData, 'return', combinedDoc);
            } else if (type === 'bill_of_exchange') {
                combinedDoc = await generateBillOfExchangePDF(docData, 'return', combinedDoc);
            } else if (type === 'bank_application') {
                combinedDoc = await generateBankApplicationPDF(docData, 'return', combinedDoc);
            }
        }

        if (combinedDoc) {
            if (action === 'preview') {
                window.open(combinedDoc.output('bloburl'), '_blank');
            } else {
                combinedDoc.save(`Documents_${data.invoiceNo || 'Draft'}.pdf`);
            }
        }
    } catch (err) {
        console.error("Combined PDF Error:", err);
        alert("Error generating combined document: " + err.message);
    }
};

export const downloadInvoiceExcel = (data) => {
    const rows = [
        ['INVOICE'],
        ['Invoice No', data.invoiceNo, 'Date', data.date],
        ['Customer', data.partyName],
        ['Description', `Qty (${data.baseUnitSymbol || 'KGS'})`, 'Rate', 'Amount'],
        ...data.items.map(i => [i.productName, i.quantity, i.rate, i.total]),
        ['', '', 'Total', data.grandTotalForeign]
    ];

    let html = '<html><head><meta charset="UTF-8"></head><body><table>';
    rows.forEach(row => {
        html += '<tr>' + row.map(cell => `<td>${cell || ''}</td>`).join('') + '</tr>';
    });
    html += '</table></body></html>';

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_${data.invoiceNo || 'Draft'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

export const generateAccountingVoucherPDF = async (data, action = 'download', existingDoc = null) => {
    const doc = existingDoc || new jsPDF();
    if (existingDoc) doc.addPage();
    const pageWidth = 210;
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const centerX = pageWidth / 2;
    const printOptions = data.printOptions || {};

    try {
        let titleY = 12;
        let startY = 20;

        if (printOptions.headerImage) {
            try {
                const img = await loadImage(printOptions.headerImage);
                const headerH = 30;
                doc.addImage(img, 'JPEG', margin, 5, contentWidth, headerH);
                titleY = 5 + headerH + 10;
                startY = titleY + 8;
            } catch (err) { console.warn("Header Error:", err); }
        }

        const vType = data.type || 'out';
        const title = printOptions.selectedHeading || (vType === 'in' ? "RECEIPT VOUCHER" : vType === 'out' ? "PAYMENT VOUCHER" : vType === 'journal' ? "JOURNAL VOUCHER" : "CONTRA VOUCHER");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(title, centerX, titleY, { align: "center" });

        doc.setLineWidth(0.1);
        doc.rect(margin, startY, contentWidth, 30);

        doc.setFontSize(9);
        doc.text(`Voucher No: ${data.refNo || '-'}`, margin + 2, startY + 8);
        doc.text(`Date: ${data.date || '-'}`, pageWidth - margin - 2, startY + 8, { align: 'right' });

        doc.text(`Source (Account): ${data.sourceName || '-'}`, margin + 2, startY + 18);
        doc.text(`Currency: ${data.currencySymbol || 'AED'} ${data.exchangeRate !== 1 ? `(Rate: ${data.exchangeRate})` : ''}`, margin + 2, startY + 25);

        // Body Table
        const headers = [["Particulars", "Narrations", "Amount"]];
        let body = [];
        if (data.isMulti && data.splits) {
            body = data.splits.map(s => [
                s.targetName || '---',
                s.description || '',
                Number(s.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]);
        } else {
            body = [[
                data.targetName || '---',
                data.narration || '',
                Number(data.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]];
        }

        autoTable(doc, {
            startY: startY + 35,
            head: headers,
            body: body,
            theme: 'plain',
            tableWidth: contentWidth,
            margin: { left: margin },
            styles: { fontSize: 10, cellPadding: 5, lineColor: 0, lineWidth: 0.1, font: "helvetica", textColor: 0 },
            headStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'center', lineWidth: 0.1, lineColor: 0 },
            columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 80 }, 2: { cellWidth: 40, halign: 'right' } },
            foot: [["Total", "", Number(data.baseAmount || data.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })]],
            footStyles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240], textColor: 0, lineWidth: 0.1, lineColor: 0 }
        });

        let finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(9);
        doc.text(`Amount in words: ${convertNumberToWords(data.baseAmount || data.amount)} ONLY`, margin, finalY);

        if (data.narration && !data.isMulti) {
            finalY += 10;
            doc.text(`Remarks: ${data.narration}`, margin, finalY, { maxWidth: contentWidth });
        }

        // Signature area
        finalY = Math.max(finalY + 30, 250);
        doc.line(margin, finalY, margin + 50, finalY);
        doc.text("Accountant", margin + 5, finalY + 5);

        doc.line(centerX - 25, finalY, centerX + 25, finalY);
        doc.text("Receiver", centerX - 10, finalY + 5);

        doc.line(pageWidth - margin - 50, finalY, pageWidth - margin, finalY);
        doc.text("Authorized Signatory", pageWidth - margin - 45, finalY + 5);

        if (action === 'preview') {
            window.open(doc.output('bloburl'), '_blank');
        } else if (action === 'return') {
            return doc;
        } else {
            doc.save(`${title.replace(/\s+/g, '_')}_${data.refNo || 'Draft'}.pdf`);
        }
    } catch (err) {
        console.error("Voucher PDF Error:", err);
        alert("Error: " + err.message);
    }
};
