export type CustomerQuoteTermsSubsection = {
  title: string;
  paragraphs: string[];
};

export type CustomerQuoteTermsSectionContent = {
  title: string;
  paragraphs?: string[];
  subsections?: CustomerQuoteTermsSubsection[];
};

export const CUSTOMER_QUOTE_TERMS_SECTIONS: CustomerQuoteTermsSectionContent[] =
  [
    {
      title: "Invoice / Order Queries",
      paragraphs: [
        "Invoice / Order Queries: Any queries regarding invoices, order details, or charges must be submitted in writing to accounts@candidcreative.uk within 7 calendar days of the Tax invoice date.",
        "This includes, but is not limited to, the quality of the finished goods, pricing of the project, or any associated services such as installation or post-event removal (if applicable).",
        "Outside of this 7-day period, the commercial figures stated on the invoice will be deemed accepted by both parties, with no room for challenge or dispute at a later date.",
        "We will do our best to resolve any queries promptly.",
        "Any disputes not raised within this period may not be considered.",
        "Failure to raise queries within 7 days of the Invoice will be taken as acceptance of the invoice and its details.",
      ],
    },
    {
      title: "Damage Liability",
      paragraphs: [
        "By accepting our quotation, the client acknowledges and agrees that Candid Creative shall not be held liable for any damage to underlying materials, surfaces, fixtures, or structures resulting from the installation or removal of event-related items.",
        "This includes, but is not limited to, any penetrative or cosmetic damage (such as the loss of paint, scuffs, holes, or marks) caused by vinyl application, adhesives, nails, tape, or other fixings.",
        "While we exercise all reasonable care, we cannot guarantee zero damage due to the inherent variability of materials and substrates.",
        "This limitation of liability applies whether the installation or derig is carried out by Candid Creative or the client themselves.",
      ],
    },
    {
      title: "Artworking Proofing and Approval",
      subsections: [
        {
          title: "Artwork Creation & Approval",
          paragraphs: [
            "Once you provide the necessary design brief, digital assets and logos, our team will create the requested artwork according to your specifications.",
            "You will receive a digital proof for review before production.",
            "It is your responsibility to check all artwork including layout, colours, spelling, dimensions and logo placement.",
            "Written approval authorises production.",
          ],
        },
        {
          title: "Hourly Charges",
          paragraphs: [
            "Artwork is charged at:",
            "£50 + VAT per hour",
            "rounded to the nearest 15 minutes.",
            "Outside working hours:",
            "£60 + VAT per hour.",
          ],
        },
        {
          title: "Additional Edits",
          paragraphs: [
            "Changes after approval may incur artwork, production and material costs.",
          ],
        },
        {
          title: "Client Responsibility",
          paragraphs: [
            "Clients remain responsible for checking artwork before approval.",
          ],
        },
        {
          title: "Artwork Invoicing",
          paragraphs: ["Artwork is invoiced separately from production."],
        },
      ],
    },
  ];
