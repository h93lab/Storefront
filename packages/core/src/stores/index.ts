import { androidClient } from "./android"
import { iosClient } from "./ios"
import type { Store, StoreClient } from "./types"

export * from "./types"
export { parseStoreUrl } from "./parse-url"

const clients: Record<Store, StoreClient> = { ios: iosClient, android: androidClient }
export const storeClient = (store: Store): StoreClient => clients[store]
