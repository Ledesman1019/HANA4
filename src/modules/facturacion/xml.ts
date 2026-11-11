import type { BillingDocument } from "./provider";
import { IDENTITY_CODES, KIND_CODES } from "./types";

const esc = (value: string | number) =>
  String(value).replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
const n2 = (value: number) => value.toFixed(2);

/**
 * XML con la estructura UBL 2.1 que exige SUNAT (simplificada y sin firma
 * digital). Sirve para ver qué se enviaría; el proveedor real lo firma con
 * el certificado de la empresa.
 */
export function buildXml(doc: BillingDocument): string {
  const credit = doc.kind === "nota_credito";
  const root = credit ? "CreditNote" : "Invoice";
  const line = credit ? "CreditNoteLine" : "InvoiceLine";
  const qty = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const [date, time] = [doc.issuedAt.slice(0, 10), doc.issuedAt.slice(11, 19)];
  const rate = doc.taxRate / 100;

  const lines = doc.items
    .map((item, i) => {
      const base = item.total / (1 + rate);
      return `  <cac:${line}>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${qty} unitCode="NIU">${item.quantity}</cbc:${qty}>
    <cbc:LineExtensionAmount currencyID="${doc.currency}">${n2(base)}</cbc:LineExtensionAmount>
    <cac:PricingReference><cac:AlternativeConditionPrice><cbc:PriceAmount currencyID="${doc.currency}">${n2(item.unitPrice)}</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice></cac:PricingReference>
    <cac:TaxTotal><cbc:TaxAmount currencyID="${doc.currency}">${n2(item.total - base)}</cbc:TaxAmount></cac:TaxTotal>
    <cac:Item><cbc:Description>${esc(item.description)}</cbc:Description><cac:SellersItemIdentification><cbc:ID>${esc(item.sku)}</cbc:ID></cac:SellersItemIdentification></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${doc.currency}">${n2(item.unitPrice / (1 + rate))}</cbc:PriceAmount></cac:Price>
  </cac:${line}>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DOCUMENTO DE DEMOSTRACIÓN · ERP HANA4 · Sin firma digital ni validez tributaria -->
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${esc(doc.number)}</cbc:ID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  ${credit ? "" : `<cbc:InvoiceTypeCode listID="0101">${KIND_CODES[doc.kind]}</cbc:InvoiceTypeCode>`}
  <cbc:DocumentCurrencyCode>${doc.currency}</cbc:DocumentCurrencyCode>${
    doc.reference
      ? `
  <cac:DiscrepancyResponse><cbc:ReferenceID>${esc(doc.reference.number)}</cbc:ReferenceID><cbc:ResponseCode>01</cbc:ResponseCode><cbc:Description>${esc(doc.reference.reason)}</cbc:Description></cac:DiscrepancyResponse>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(doc.reference.number)}</cbc:ID><cbc:DocumentTypeCode>${KIND_CODES[doc.reference.kind]}</cbc:DocumentTypeCode></cac:InvoiceDocumentReference></cac:BillingReference>`
      : ""
  }
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">${esc(doc.company.taxId)}</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(doc.company.name)}</cbc:RegistrationName><cac:RegistrationAddress><cac:AddressLine><cbc:Line>${esc(doc.company.address)}</cbc:Line></cac:AddressLine></cac:RegistrationAddress></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="${IDENTITY_CODES[doc.customer.docType] ?? "0"}">${esc(doc.customer.docNumber || "00000000")}</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(doc.customer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${doc.currency}">${n2(doc.tax)}</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="${doc.currency}">${n2(doc.subtotal)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${doc.currency}">${n2(doc.tax)}</cbc:TaxAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${doc.currency}">${n2(doc.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${doc.currency}">${n2(doc.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${doc.currency}">${n2(doc.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</${root}>
`;
}
