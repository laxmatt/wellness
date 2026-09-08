// Typed event union. No health text, no raw matcher input, ever.
export type AnalyticsEvent =
  | { type: "category_viewed"; categoryId: string; facet?: string }
  | { type: "filter_selected"; categoryId: string; key: string; value: string }
  | { type: "matcher_submitted"; categoryId: string; charCount: number }
  | { type: "preferences_extracted"; categoryId: string; hardKeys: string[]; softKeys: string[]; unmappedCount: number; medicalIntent: boolean }
  | { type: "product_recommended"; categoryId: string; productId: string; badge: string | null; personalized: boolean }
  | { type: "recommendation_overridden"; categoryId: string; fromProductId: string; toProductId: string }
  | { type: "product_compared"; categoryId: string; productIds: string[] }
  | { type: "retailer_clicked"; productId: string; offerId: string; merchantId: string; affiliateStatus: string }
  | { type: "comparison_saved"; categoryId: string; productIds: string[] };

export type AnalyticsEventType = AnalyticsEvent["type"];
