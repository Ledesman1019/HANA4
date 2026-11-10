export const THEME_KEY = "hana4-theme";

/**
 * Script que corre antes del primer pintado: aplica el tema guardado (o el
 * del sistema) para que la página nunca parpadee en el tema equivocado.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;
