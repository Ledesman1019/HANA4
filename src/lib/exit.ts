"use client";

/**
 * Salir de la aplicación. En la app instalada en la computadora (Chrome, Edge)
 * cierra la ventana. Donde el sistema no deja que una web se cierre sola
 * (Android, o una pestaña normal del navegador), muestra la pantalla de salida.
 */
export function exitApp() {
  window.close();
  setTimeout(() => {
    if (!window.closed) window.location.replace("/adios");
  }, 300);
}
