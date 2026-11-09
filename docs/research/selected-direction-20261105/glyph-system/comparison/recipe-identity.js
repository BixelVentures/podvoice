// Candidate staging of the canonical catalogue identity fix. Keep the actual
// RecipeView fetch/render/session owners; only reconcile equivalent objects.
const installed = new WeakSet();
export function installRecipeIdentity(host) {
    const view = host.recipeView;
    if (host.live !== false || !view || installed.has(view)) return;
    installed.add(view);
    const refresh = view.refreshPublishedCatalog;
    view.refreshPublishedCatalog = async function (...args) {
        const previous = new Map(this.saved.map(recipe => [recipe.source?.url, recipe]));
        const changed = await refresh.apply(this, args);
        this.saved = this.saved.map(recipe => {
            const retained = previous.get(recipe.source?.url);
            if (!retained || retained === recipe || JSON.stringify(retained) !== JSON.stringify(recipe)) return recipe;
            // Restoration may have bound a persisted session to the freshly
            // fetched object. Move that same session, never fabricate progress.
            if (this.sessions.has(recipe)) {
                this.sessions.set(retained, this.sessions.get(recipe));
                this.sessions.delete(recipe);
            }
            if (this.active === recipe) this.active = retained;
            return retained;
        });
        return changed;
    };
}
