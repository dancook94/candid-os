export type DeliveryAddressSource = "saved" | "new" | "new_saved";

export type QuoteRequestDeliveryInput =
  | {
      mode: "saved";
      savedAddressId: string;
    }
  | {
      mode: "new";
      saveForFuture: boolean;
      label?: string | null;
      recipientName: string;
      addressLine1: string;
      addressLine2?: string | null;
      city: string;
      county?: string | null;
      postcode: string;
      country: string;
      phone?: string | null;
      deliveryInstructions?: string | null;
    };

export type SubmitCustomerQuoteRequestBody = {
  projectName: string;
  description: string;
  fulfilmentMethod: "delivery" | "collection";
  requestedDate: string;
  requestedTime?: string | null;
  purchaseOrderNumber?: string | null;
  notes?: string | null;
  delivery?: QuoteRequestDeliveryInput | null;
};

export type SavedAddressOption = {
  id: string;
  label: string | null;
  recipient_name: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string;
  country: string;
  phone: string | null;
  delivery_instructions: string | null;
  is_default_delivery: boolean;
};
