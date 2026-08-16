import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, Plugin} from 'vite';

function copyStaticPagesPlugin(): Plugin {
  return {
    name: 'copy-static-pages',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const htmlFiles = [
        'signin.html',
        'register-type.html',
        'examination-schedules.html',
        'verify-id-certificate.html',
        'verify-qr-code.html',
        'verify-recaptcha.html',
        'done.html',
      ];
      
      const copyRecursive = (src: string, dest: string) => {
        if (!fs.existsSync(src)) return;
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
          fs.readdirSync(src).forEach((child) => {
            copyRecursive(path.join(src, child), path.join(dest, child));
          });
        } else {
          fs.copyFileSync(src, dest);
        }
      };

      for (const file of htmlFiles) {
        const srcPath = path.resolve(__dirname, file);
        const destPath = path.join(distDir, file);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }

      copyRecursive(path.resolve(__dirname, 'static'), path.join(distDir, 'static'));
      copyRecursive(path.resolve(__dirname, 'public'), distDir);
      copyRecursive(path.resolve(__dirname, 'officer_image'), path.join(distDir, 'officer_image'));
      copyRecursive(path.resolve(__dirname, 'assets'), path.join(distDir, 'assets'));
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copyStaticPagesPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      watch: null,
    },
  };
});
