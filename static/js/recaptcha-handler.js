(function () {
  const RECAPTCHA_SITE_KEY = '6LcuU3gtAAAAAJVuF5m1pl7oi8uARL-rS7wqFp4w';

  function initRecaptchaGlobal() {
    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      const explicitContainers = document.querySelectorAll('[data-onloadcallbackname="onloadCallback"], .g-recaptcha[data-sitekey]');
      explicitContainers.forEach(function (container) {
        if (container.dataset.rendered !== 'true' && !container.children.length) {
          try {
            window.grecaptcha.render(container, {
              sitekey: RECAPTCHA_SITE_KEY,
              theme: 'light'
            });
            container.dataset.rendered = 'true';
          } catch (e) {}
        }
      });
    }
  }

  window.initRecaptcha = function () {
    initRecaptchaGlobal();
    if (typeof window.onloadCallback === 'function') {
      try { window.onloadCallback(); } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRecaptchaGlobal, { once: true });
  } else {
    initRecaptchaGlobal();
  }
})();
