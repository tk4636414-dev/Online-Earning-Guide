(() => {
    const languageSelect = document.getElementById("languageSelect");

    function applyLanguageLayout(language) {
        const selectedLanguage = language === "en" ? "en" : "ur";
        const direction = selectedLanguage === "en" ? "ltr" : "rtl";

        document.documentElement.lang = selectedLanguage;
        document.documentElement.dir = direction;
        document.body.dir = direction;

        if (languageSelect) {
            languageSelect.value = selectedLanguage;
        }

        return selectedLanguage;
    }

    const savedTranslation = document.cookie
        .split("; ")
        .find(cookie => cookie.startsWith("googtrans="))
        ?.split("=")[1];
    const savedLanguage = savedTranslation?.split("/")[2];
    applyLanguageLayout(savedLanguage);

    window.changeLanguage = selectObj => {
        const language = applyLanguageLayout(selectObj.value);
        const translateSelect = document.querySelector(".goog-te-combo");

        if (translateSelect) {
            translateSelect.value = language;
            translateSelect.dispatchEvent(new Event("change"));
            return;
        }

        const translationPath = `/ur/${language}`;
        if (savedTranslation === translationPath) return;

        document.cookie = `googtrans=${translationPath}; path=/`;
        window.location.reload();
    };
})();
