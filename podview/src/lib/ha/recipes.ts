// Opskrifter on HA: the PodVoice add-on's published recipe catalog through our integration (podvoice.recipes_snapshot,
// custom_components/podvoice/recipes_bridge.py), never from the add-on directly. The catalog changes only when a
// recipe is uploaded, so it is read when the page starts (the Home tile keeps it warm), after a resync and every
// ten minutes; the screen draws the last catalog read at once. Each recipe is validated here; a malformed one is
// left out, never guessed. The cooking session (the active recipe, ticked steps) is the wall's own
// (screens/recipe/session.ts).
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {haKeys, serviceResponse} from './transport';

const text = (max: number) => z.string().trim().min(1).max(max);
const url = z.string().max(2048).regex(/^https?:\/\//);

export const recipeSchema = z.looseObject({
  title: text(160),
  steps: z.array(text(4000)).min(1).max(60),
  categories: z.array(text(60)).max(12).optional(),
  publisher: text(120).optional(),
  portions: text(80).optional(),
  waiting: text(120).optional(),
  baking: text(120).optional(),
  cookingTime: text(120).optional(),
  totalTime: text(120).optional(),
  description: text(1200).optional(),
  image: url.optional(),
  images: z.array(url).max(12).optional(),
  ingredients: z.array(text(400)).max(120).optional(),
  groups: z.array(z.looseObject({title: text(120), lines: z.array(text(400)).max(120)})).max(20).optional(),
  // Step index → phase title (»Æltning«), the phase starting at that step.
  phases: z.record(z.string().regex(/^\d{1,2}$/), text(80)).optional(),
  createdAt: z.number().optional(),
  source: z.looseObject({url, uploadedAt: z.number().optional()}),
});
export type Recipe = z.infer<typeof recipeSchema>;

const replySchema = z.union([
  z.looseObject({ok: z.literal(true), recipes: z.array(z.unknown()).max(500)}),
  z.looseObject({ok: z.literal(false), error: z.string().max(80)}),
]);

export type RecipesRead = {ok: true; recipes: Recipe[]} | {ok: false; error: string};

// Every recipe the panel can draw, once per source URL (the add-on's identity of a recipe).
export function readRecipes(rows: readonly unknown[]): Recipe[] {
  const seen = new Set<string>();
  const recipes: Recipe[] = [];
  for (const row of rows) {
    const parsed = recipeSchema.safeParse(row);
    if (!parsed.success || seen.has(parsed.data.source.url)) continue;
    seen.add(parsed.data.source.url);
    recipes.push(parsed.data);
  }
  return recipes;
}

export const recipesKey = (generation: number) => [...haKeys.read, 'recipes', generation] as const;

export function useRecipes(generation: number) {
  return useQuery({
    queryKey: recipesKey(generation),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 10 * 60_000,
    // A new generation (the wall woke up) keeps the last catalog on screen while it is read again.
    placeholderData: previous => previous,
    queryFn: async (): Promise<RecipesRead> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'recipes_snapshot', data: {}, returnResponse: true},
        replySchema,
      );
      if (!result.ok) return {ok: false, error: result.outcome === 'rejected' ? 'service_unavailable' : 'unknown'};
      return result.value.ok ? {ok: true, recipes: readRecipes(result.value.recipes)} : result.value;
    },
  });
}
