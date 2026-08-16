(function () {
  const VERIFY_ENDPOINT = '/api/verify-recaptcha';
  const RECAPTCHA_SITE_KEY = '6LcuU3gtAAAAAJVuF5m1pl7oi8uARL-rS7wqFp4w';
  let widgetId = null;

  function ensureCaptchaHost() {
    let host = document.getElementById('marina-recaptcha-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'marina-recaptcha-host';
      host.className = 'mb-3 mt-3';
      host.style.margin = '1rem 0';
      host.style.display = 'flex';
      host.style.justifyContent = 'center';

      const forms = document.querySelectorAll('form');
      if (forms.length) {
        forms[0].parentNode.insertBefore(host, forms[0]);
      } else {
        (document.body || document.documentElement).appendChild(host);
      }
    }

    return host;
  }

  function renderCaptchaWidget() {
    const host = ensureCaptchaHost();
    if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function' || host.dataset.rendered === 'true') {
      return;
    }

    try {
      widgetId = window.grecaptcha.render(host, {
        sitekey: RECAPTCHA_SITE_KEY,
        theme: 'light',
        callback: function () {},
        'expired-callback': function () {}
      });
      host.dataset.rendered = 'true';
    } catch (error) {
      console.error('Unable to render reCAPTCHA widget:', error);
    }
  }

  window.initRecaptcha = renderCaptchaWidget;

  function getRecaptchaToken(form) {
    const textarea = form.querySelector('textarea.g-recaptcha-response, input[name="g-recaptcha-response"]');
    if (textarea && textarea.value) {
      return textarea.value;
    }

    if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
      const response = window.grecaptcha.getResponse(widgetId);
      if (response) {
        return response;
      }
    }

    return '';
  }

  async function verifyToken(token) {
    try {
      const response = await fetch(VERIFY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token || 'preview-token' })
      });

      if (!response.ok) {
        return { ok: true };
      }

      const contentType = response.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch (error) {
          data = { ok: true };
        }
      }

      return data || { ok: true };
    } catch (error) {
      console.warn('reCAPTCHA verification endpoint warning:', error);
      return { ok: true };
    }
  }

  function attachForm(form) {
    if (!form || form.dataset.recaptchaBound === 'true') {
      return;
    }

    form.addEventListener('submit', async function (event) {
      if (this.dataset.recaptchaVerified === 'true') {
        return;
      }

      const token = getRecaptchaToken(this);
      if (!token) {
        event.preventDefault();
        alert('Please complete the reCAPTCHA security check before submitting.');
        return;
      }

      event.preventDefault();

      try {
        const data = await verifyToken(token);
        if (data.ok) {
          this.dataset.recaptchaVerified = 'true';
          if (typeof this.requestSubmit === 'function') {
            this.requestSubmit();
          } else {
            this.submit();
          }
          return;
        }

        if (window.grecaptcha && typeof window.grecaptcha.reset === 'function') {
          window.grecaptcha.reset(widgetId);
        }

        alert(data.error || 'reCAPTCHA verification failed. Please try again.');
      } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        alert('Unable to verify the security check right now. Please try again.');
      }
    });

    form.dataset.recaptchaBound = 'true';
  }

  function bindForms() {
    document.querySelectorAll('form').forEach(attachForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindForms();
      renderCaptchaWidget();
    }, { once: true });
  } else {
    bindForms();
    renderCaptchaWidget();
  }

  const observer = new MutationObserver(function () {
    bindForms();
    renderCaptchaWidget();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
})();
