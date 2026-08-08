const config = {
  plugins: {
    // Tailwind v4 ย้าย PostCSS plugin ออกมาเป็นแพ็กเกจแยก
    // autoprefixer ไม่ต้องใช้แล้ว — v4 เติม prefix ให้เองผ่าน Lightning CSS
    "@tailwindcss/postcss": {},
  },
};

export default config;
