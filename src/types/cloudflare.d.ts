/** Workers専用の型はモジュール内で参照し、BunのRequest/Responseのグローバル型を変更しない。 */
declare module 'cloudflare:workers' {
  export const DurableObject: typeof import('@cloudflare/workers-types/index').CloudflareWorkersModule.DurableObject
}
