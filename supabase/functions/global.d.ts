// Type declarations for Deno runtime in Supabase Edge Functions
// This silences IDE language server errors in editors without active Deno language server plugins.

declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
  [key: string]: any;
};

declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "npm:*" {
  const content: any;
  export default content;
  export = content;
}
