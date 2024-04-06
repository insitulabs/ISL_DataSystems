const CONFIG = require('../config');

module.exports = {
  /**
   * Get the translated key from the given source object. Fallback to native key if we don't
   * have a translation or a language set.
   * @param {Object} source The source or view.
   * @param {String} key The source field: 'name', 'note'
   * @param {String} language 2 letter language code.
   * @return {String}
   */
  altLang: function (source, key, language) {
    let value = '';
    if (source) {
      if (language && source.altLang && source.altLang[language] && source.altLang[language][key]) {
        value = source.altLang[language][key];
      }

      if (!value && source[key]) {
        value = source[key];
      }
    }

    return value;
  },

  /**
   * Get the translated field name. Fallback to original name if no translation or lang set.
   * @param {Object} field The field.
   * @param {String} language 2 letter language code.
   * @return {String}
   */
  altLangFieldName: function (field, language) {
    let name = '';
    if (field) {
      if (language && field.altLang && field.altLang[language]) {
        name = field.altLang[language];
      }

      if (!name && field.name) {
        name = field.name;
      }

      if (!name) {
        name = field.id;
      }
    }

    return name;
  },

  /**
   * Populate an array of languages.
   * @param {Array} languageCodes The language codes
   * @return {Array}
   */
  loadLanguages: function (languageCodes = []) {
    const engLang = new Intl.DisplayNames([CONFIG.PRIMARY_LANG], { type: 'language' });
    return languageCodes.map((id) => {
      let lang = { id };
      lang.name = engLang.of(id);
      const localLang = new Intl.DisplayNames([id], { type: 'language' });
      if (localLang) {
        lang.nativeName = localLang.of(id);
      }
      return lang;
    });
  }
};

