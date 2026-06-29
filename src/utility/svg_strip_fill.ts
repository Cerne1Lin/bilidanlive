export default function stripFill(svg: string): string {
    return (
        svg
            // 去掉 width/height，交给 CSS 控制尺寸
            .replace(/\swidth="[^"]*"/g, "")
            .replace(/\sheight="[^"]*"/g, "")
            // 处理所有形状元素的 fill 和 stroke
            .replace(
                /<(path|circle|rect|ellipse|line|polyline|polygon)\b([^>]*?)(\s*\/?)>/g,
                (_: string, tag: string, attrs: string, selfClose: string) => {
                    let newAttrs = attrs;
                    // 有 fill → 替换非 "none" 的颜色为 currentColor
                    if (/\bfill=/.test(newAttrs)) {
                        newAttrs = newAttrs.replace(
                            /\sfill="(?!none)[^"]*"/g,
                            'fill="currentColor"',
                        );
                    } else {
                        // 没有 fill → 补上
                        newAttrs += ' fill="currentColor"';
                    }
                    // stroke 同理
                    if (/\bstroke=/.test(newAttrs)) {
                        newAttrs = newAttrs.replace(
                            /\sstroke="(?!none)[^"]*"/g,
                            'stroke="currentColor"',
                        );
                    }
                    return `<${tag}${newAttrs}${selfClose}>`;
                },
            )
    );
}
