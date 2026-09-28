export type Store = "ios" | "android"

export interface AppRef {
  store: Store
  storeId: string
  country: string
  lang: string
}

/** Listing data normalized across both stores. */
export interface StoreListing {
  storeId: string
  name: string
  developer: string | null
  category: string | null
  description: string | null
  releaseNotes: string | null
  price: string | null
  priceValue: number | null
  currency: string | null
  rating: number | null
  ratingsCount: number | null
  version: string | null
  updatedAt: Date | null
  sizeBytes: number | null
  contentRating: string | null
  url: string | null
  iconUrl: string | null
  screenshots: { url: string; device: "phone" | "tablet" }[]
}

export interface StoreReview {
  id: string
  author: string | null
  rating: number | null
  title: string | null
  body: string | null
  version: string | null
  date: Date | null
}

export interface StoreSearchResult {
  store: Store
  storeId: string
  name: string
  developer: string | null
  iconUrl: string | null
  rating: number | null
  url: string | null
}

export interface StoreClient {
  listing(ref: AppRef): Promise<StoreListing>
  reviews(ref: AppRef, max: number): Promise<StoreReview[]>
  search(term: string, country: string, lang: string, limit: number): Promise<StoreSearchResult[]>
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "StoreError"
  }
}
