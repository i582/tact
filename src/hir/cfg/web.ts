import * as fs from 'fs';
import * as path from 'path';

const svgpanJs = fs.readFileSync(path.join(__dirname, 'svgpan.js')).toString()

const webAdditionHeader = `
<script type="text/ecmascript"><![CDATA[
${svgpanJs}
]]></script>

<g id="viewport" transform="scale(0.5,0.5) translate(0,0)">`;

const webAdditionFooter = `
</g>`;

export function injectSvgStyles(svgContent: string): string {
    const headerStr = 'xmlns:xlink="http://www.w3.org/1999/xlink">';
    const startGraphData = svgContent.indexOf(headerStr) + headerStr.length;
    const startSvg = svgContent.indexOf('<svg ') + 5;
    const startViewBox = svgContent.indexOf(' viewBox');
    const startEndSvg = svgContent.indexOf('</svg>');

    if (startSvg === -1 || startViewBox === -1 || startEndSvg === -1) {
        return svgContent;
    }

    return (
        svgContent.slice(0, startSvg) +
        'width="100%" height="100%"' +
        svgContent.slice(startViewBox, startGraphData) +
        webAdditionHeader +
        svgContent.slice(startGraphData, startEndSvg) +
        webAdditionFooter +
        svgContent.slice(startEndSvg)
    );
}

export function applySvgStyles(filePath: string): void {
    const svgContent = fs.readFileSync(filePath, 'utf8');
    const styledSvg = injectSvgStyles(svgContent);
    fs.writeFileSync(filePath, styledSvg);
} 
