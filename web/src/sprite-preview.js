/** 静态查看切片；只计算展示几何，不改变文件中的坐标或尺寸。 */
export function spritePreviewLayout(sprite, texture) {
  const { x, y, w, h } = sprite;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    throw new Error('请输入有效的坐标，切片宽高必须大于 0');
  }
  const scale = Math.min(4, 512 / w, 384 / h);
  return {
    size: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) },
    outline: { left: x / texture.width * 100, top: y / texture.height * 100,
      width: w / texture.width * 100, height: h / texture.height * 100 },
    outside: x < 0 || y < 0 || x + w > texture.width || y + h > texture.height,
  };
}
