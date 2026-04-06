import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Number to Words Converter (Simplified for AED)
const numberToWords = (n) => {
    const string = n.toString(), units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'], tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'], scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
    let start = string.length, chunks = [], end = 0;
    while (start > 0) {
        end = start;
        chunks.push(string.slice((start = Math.max(0, start - 3)), end));
    }
    let chunksLen = chunks.length;
    if (chunksLen > scales.length) { return ''; }
    let words = [], word;
    for (let i = 0; i < chunksLen; i++) {
        let chunk = parseInt(chunks[i]);
        if (chunk) {
            let ints = chunks[i].split('').reverse().map(parseFloat);
            if (ints[1] === 1) { ints[0] += 10; }
            if ((word = scales[i])) { words.push(word); }
            if ((word = units[ints[0]])) { words.push(word); }
            if ((word = tens[ints[1]])) { words.push(word); }
            if ((word = units[ints[2]])) { words.push(word + ' Hundred'); }
        }
    }
    return words.reverse().join(' ');
};

export const generateCommercialInvoice = (formData, items, party, totals, userSettings = {}) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    // --- COLORS ---
    const primaryColor = [150, 0, 0]; // Dark Red for Header
    const black = [0, 0, 0];

    // --- HEADER ---
    doc.setTextColor(...primaryColor);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("AL SAHAM AL AHMAR", margin, 20);
    doc.text("METALS SCRAP TR.", margin, 28);

    doc.setTextColor(...black);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(userSettings.selectedHeading || "TAX INVOICE", pageWidth / 2, 40, { align: "center", charSpace: 1 });

    // --- BOX 1: EXPORTER & INVOICE DETAILS ---
    const startY = 45;
    const box1H = 35;
    const colSplit = pageWidth * 0.55;

    doc.setLineWidth(0.3);
    doc.rect(margin, startY, pageWidth - (margin * 2), box1H); // Outer
    doc.line(margin + colSplit, startY, margin + colSplit, startY + box1H); // Vertical

    // Left: Exporter
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(userSettings.companyName || "AL SAHAM AL AHMAR METALS SCRAP TR.", margin + 2, startY + 5);
    doc.setFont("helvetica", "normal");
    doc.text("SAJJA INDUSTRIAL AREA", margin + 2, startY + 10);
    doc.text("SHARJAH, U.A.E", margin + 2, startY + 14);
    doc.text("Emirate: Sharjah", margin + 2, startY + 18);
    doc.text(`TRN: ${userSettings.trn || "100350623300003"}`, margin + 2, startY + 22);
    doc.text(`Email: ${userSettings.email || "info@asamplast.com"}`, margin + 2, startY + 26);

    // Right: Inv Details
    const rightX = margin + colSplit + 2;
    // Row 1
    doc.setFont("helvetica", "bold");
    doc.text("Invoice No.", rightX, startY + 5);
    doc.text("Date", rightX + 45, startY + 5);
    doc.setFont("helvetica", "normal");
    doc.text(formData.refNo || "-", rightX, startY + 10);
    doc.text(formData.date || "-", rightX + 45, startY + 10);

    doc.line(margin + colSplit, startY + 14, pageWidth - margin, startY + 14); // H-Line

    // Row 2
    doc.setFont("helvetica", "bold");
    doc.text("Delivery Note", rightX, startY + 19);
    doc.text("Delivery Note Date", rightX + 45, startY + 19);
    doc.setFont("helvetica", "normal");
    doc.text(formData.otherRef || "-", rightX, startY + 24);
    doc.text(formData.date || "-", rightX + 45, startY + 24);

    doc.line(margin + colSplit, startY + 28, pageWidth - margin, startY + 28); // H-Line

    // Row 3 (Supplier Ref / Dated)
    doc.setFont("helvetica", "bold");
    doc.text("Supplier's Ref.", rightX, startY + 33);
    doc.text("Dated", rightX + 45, startY + 33);


    // --- BOX 2: CONSIGNEE & BUYER ---
    const box2Y = startY + box1H;
    const box2H = 45;

    doc.rect(margin, box2Y, pageWidth - (margin * 2), box2H);
    doc.line(margin + colSplit, box2Y, margin + colSplit, box2Y + box2H);

    // Left: Consignee
    doc.setFont("helvetica", "bold");
    doc.text("Consignee", margin + 2, box2Y + 4);
    doc.text(party?.name || "CASH CUSTOMER", margin + 2, box2Y + 9);
    doc.setFont("helvetica", "normal");
    const addressLines = doc.splitTextToSize(party?.address || "", colSplit - 4);
    doc.text(addressLines, margin + 2, box2Y + 14);

    // Buyer
    doc.setFont("helvetica", "bold");
    doc.text("Buyer (if other than Consignee)", margin + 2, box2Y + 26);
    doc.setFont("helvetica", "normal");
    doc.text(party?.name || "", margin + 2, box2Y + 31);
    doc.text(addressLines[0] || "", margin + 2, box2Y + 35);
    doc.text(`TRN : ${party?.trn || "-"}`, margin + 2, box2Y + 39);

    // Right: P I NO & Dispatch
    // Row 1: P I NO
    doc.text(`PI NO: ${formData.otherRef || "-"}  DATE: ${formData.date}`, rightX, box2Y + 6);
    doc.line(margin + colSplit, box2Y + 10, pageWidth - margin, box2Y + 10);

    // Row 2: Dispatch Doc
    doc.setFont("helvetica", "bold");
    doc.text("Dispatch Document No.", rightX, box2Y + 14);
    doc.text("Delivery Note Date", rightX + 45, box2Y + 14);
    doc.line(margin + colSplit, box2Y + 22, pageWidth - margin, box2Y + 22);

    // Row 3: Dispatched Through / Destination
    doc.text("Dispatched through", rightX, box2Y + 26);
    doc.text("Destination", rightX + 45, box2Y + 26);
    doc.setFont("helvetica", "normal");
    doc.text("Road Transport", rightX, box2Y + 31);
    doc.text(formData.locationName || "UAE", rightX + 45, box2Y + 31);
    doc.line(margin + colSplit, box2Y + 34, pageWidth - margin, box2Y + 34);

    // Row 4: Container
    doc.setFont("helvetica", "bold");
    doc.text("Container No:", rightX, box2Y + 38);
    doc.setFont("helvetica", "normal");
    doc.text(formData.containerNo || "", rightX + 22, box2Y + 38);
    if (formData.vehicleNo) doc.text(`Veh: ${formData.vehicleNo}`, rightX + 45, box2Y + 38);


    // --- TABLE ---
    const tableY = box2Y + box2H;

    const data = items.map((item, i) => [
        i + 1,
        item.productName || "Item",
        `${Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })} KGS`,
        Number(item.rate).toFixed(3),
        "KGS",
        Number(item.total).toLocaleString('en-US', { minimumFractionDigits: 2 })
    ]);

    autoTable(doc, {
        startY: tableY,
        head: [['Sl.No', 'Description of Goods', 'Quantity\n(KGS)', 'Rate', 'Per', 'Amount\n(AED)']],
        body: data,
        theme: 'plain', // Clean look
        styles: {
            fontSize: 9,
            cellPadding: 3,
            valign: 'middle',
            lineWidth: 0.1,
            lineColor: [0, 0, 0]
        },
        headStyles: {
            halign: 'center',
            fontStyle: 'bold',
            fillColor: [255, 255, 255], // White header
            textColor: [0, 0, 0]
        },
        columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 'auto' }, // Desc
            2: { cellWidth: 25, halign: 'right' },
            3: { cellWidth: 20, halign: 'right' },
            4: { cellWidth: 15, halign: 'center' },
            5: { cellWidth: 30, halign: 'right' }
        },
        didDrawPage: (data) => {
            // Draw vertical lines for the table box manually if needed, or rely on 'plain' w/ lineWidth
        }
    });

    let finalY = doc.lastAutoTable.finalY;

    // --- TOTALS ROW ---
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL", margin + 60, finalY + 5);
    doc.text(`${Number(totals.totalQty).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth - 90, finalY + 5, { align: 'right' }); // Qty Col
    doc.text(`${Number(totals.grandTotalBase).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth - margin - 2, finalY + 5, { align: 'right' }); // Amt Col

    doc.line(margin, finalY + 7, pageWidth - margin, finalY + 7);


    // --- AMOUNT IN WORDS ---
    const words = numberToWords(Math.floor(totals.grandTotalBase));
    const fils = Math.round((totals.grandTotalBase % 1) * 100);
    const wordStr = `${words} Dirhams${fils > 0 ? ` and ${numberToWords(fils)} Fils` : ''} Only.`;

    doc.setFontSize(9);
    doc.text("Amount Chargeable (in words)", margin, finalY + 12);
    doc.setFont("helvetica", "normal");
    doc.text(wordStr, margin, finalY + 17);

    // --- TAX TABLE (Right Side) ---
    if (totals.taxAmount > 0) {
        // Draw small tax table
        const taxY = finalY + 22;
        const taxW = 80;
        const taxX = pageWidth - margin - taxW;

        doc.setFontSize(8);
        doc.text("Taxable Value", taxX, taxY);
        doc.text(Number(totals.itemsTotal).toLocaleString('en-US', { minimumFractionDigits: 2 }), pageWidth - margin, taxY, { align: 'right' });

        doc.text("VAT @ 5%", taxX, taxY + 5);
        doc.text(Number(totals.taxAmount).toLocaleString('en-US', { minimumFractionDigits: 2 }), pageWidth - margin, taxY + 5, { align: 'right' });

        doc.line(taxX, taxY + 7, pageWidth - margin, taxY + 7);
        doc.setFont("helvetica", "bold");
        doc.text("Total", taxX, taxY + 11);
        doc.text(Number(totals.grandTotalBase).toLocaleString('en-US', { minimumFractionDigits: 2 }), pageWidth - margin, taxY + 11, { align: 'right' });
    } else {
        // Reverse Charge Note
        doc.setFontSize(8);
        doc.text("Note: Amount of tax subject to reverse charge mechanism.", margin, finalY + 25);
    }

    // --- SIGNATURES ---
    const sigY = finalY + 50;

    // Box for Signature
    doc.rect(margin, sigY, pageWidth - (margin * 2), 30);
    doc.line(pageWidth - 90, sigY, pageWidth - 90, sigY + 30);

    // Declaration
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("Declaration", margin + 2, sigY + 4);
    doc.setFont("helvetica", "normal");
    doc.text("We declare that this invoice shows the actual price of the goods\ndescribed and that all particulars are true and correct.", margin + 2, sigY + 9);

    // Signature Area
    doc.setFont("helvetica", "bold");
    doc.text(`for ${userSettings.companyName || "AL SAHAM AL AHMAR METALS SCRAP TR."}`, pageWidth - 88, sigY + 4);
    // Add Placeholder for Sig
    // ...
    doc.text("Authorized Signatory", pageWidth - margin - 2, sigY + 26, { align: 'right' });

    doc.save(`Invoice_${formData.refNo || 'draft'}.pdf`);
};
