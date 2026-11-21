// Definicion unica del prompt GDTF -> QLab (.qlablight).
// La usan el navegador (<script src="prompt.js">) y el Worker (import de efecto).
// Sin exports a proposito: funciona igual como script clasico y como modulo ESM.
(function (root) {
  var MAX_TPL = 20000;
  var MAX_GDTF = 60000;

  function buildPrompt(gdtf, tpl, name) {
    var g = String(gdtf || '');
    var t = String(tpl || '');
    var p = 'Converti esta definicion de fixture GDTF en una definicion de instrumento de QLab 5, '
      + 'es decir un archivo .qlablight en JSON.\n'
      + 'Reglas: una sola definicion con nombre unico y fabricante; parametros en el orden de los '
      + 'canales DMX del modo elegido; para cada parametro indica nombre, canal DMX y si usa 16 bits; '
      + 'elegi el modo DMX "Standard" o el primero disponible y reflejalo en el nombre.\n'
      + 'Responde SOLO con el JSON valido, sin markdown y sin explicaciones.\n';
    if (t) {
      p += '\nIMPORTANTE: copia exactamente la estructura, las claves y los tipos de esta plantilla '
        + '.qlablight real y solo reemplaza los valores:\n<<<PLANTILLA\n' + t.slice(0, MAX_TPL)
        + '\nPLANTILLA>>>\n';
    }
    if (name) p += '\nNombre del archivo GDTF: ' + String(name) + '\n';
    p += '\nDefinicion GDTF (description.xml):\n<<<GDTF\n' + g.slice(0, MAX_GDTF) + '\nGDTF>>>';
    return p;
  }

  root.FF_PROMPT = buildPrompt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
