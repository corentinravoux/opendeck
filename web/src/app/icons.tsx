// Icons of the editor chrome: Phosphor (regular weight, MIT), imported as raw SVG so only the
// glyphs used here are bundled. They draw in currentColor.
import arrowSquareOut from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import arrowUpRight from "@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw";
import boundingBox from "@phosphor-icons/core/assets/regular/bounding-box.svg?raw";
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretLeft from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import caretUp from "@phosphor-icons/core/assets/regular/caret-up.svg?raw";
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import clock from "@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw";
import cloudUp from "@phosphor-icons/core/assets/regular/cloud-arrow-up.svg?raw";
import code from "@phosphor-icons/core/assets/regular/code.svg?raw";
import cursor from "@phosphor-icons/core/assets/regular/cursor.svg?raw";
import eye from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import globe from "@phosphor-icons/core/assets/regular/globe-simple.svg?raw";
import lock from "@phosphor-icons/core/assets/regular/lock-simple.svg?raw";
import house from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import copy from "@phosphor-icons/core/assets/regular/copy.svg?raw";
import dots from "@phosphor-icons/core/assets/regular/dots-three.svg?raw";
import eraser from "@phosphor-icons/core/assets/regular/eraser.svg?raw";
import exportIcon from "@phosphor-icons/core/assets/regular/export.svg?raw";
import fileHtml from "@phosphor-icons/core/assets/regular/file-html.svg?raw";
import filePdf from "@phosphor-icons/core/assets/regular/file-pdf.svg?raw";
import fileZip from "@phosphor-icons/core/assets/regular/file-zip.svg?raw";
import filmStrip from "@phosphor-icons/core/assets/regular/film-strip.svg?raw";
import folder from "@phosphor-icons/core/assets/regular/folder-simple.svg?raw";
import image from "@phosphor-icons/core/assets/regular/image.svg?raw";
import images from "@phosphor-icons/core/assets/regular/images.svg?raw";
import lineSegment from "@phosphor-icons/core/assets/regular/line-segment.svg?raw";
import link from "@phosphor-icons/core/assets/regular/link-simple.svg?raw";
import listBullets from "@phosphor-icons/core/assets/regular/list-bullets.svg?raw";
import listNumbers from "@phosphor-icons/core/assets/regular/list-numbers.svg?raw";
import magnet from "@phosphor-icons/core/assets/regular/magnet.svg?raw";
import search from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import minus from "@phosphor-icons/core/assets/regular/minus.svg?raw";
import moon from "@phosphor-icons/core/assets/regular/moon.svg?raw";
import penNib from "@phosphor-icons/core/assets/regular/pen-nib.svg?raw";
import pencil from "@phosphor-icons/core/assets/regular/pencil-simple.svg?raw";
import play from "@phosphor-icons/core/assets/regular/play.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import sigma from "@phosphor-icons/core/assets/regular/sigma.svg?raw";
import square from "@phosphor-icons/core/assets/regular/square.svg?raw";
import stack from "@phosphor-icons/core/assets/regular/stack.svg?raw";
import sun from "@phosphor-icons/core/assets/regular/sun.svg?raw";
import alignCenter from "@phosphor-icons/core/assets/regular/text-align-center.svg?raw";
import alignLeft from "@phosphor-icons/core/assets/regular/text-align-left.svg?raw";
import alignRight from "@phosphor-icons/core/assets/regular/text-align-right.svg?raw";
import bold from "@phosphor-icons/core/assets/regular/text-b.svg?raw";
import italic from "@phosphor-icons/core/assets/regular/text-italic.svg?raw";
import strike from "@phosphor-icons/core/assets/regular/text-strikethrough.svg?raw";
import subscript from "@phosphor-icons/core/assets/regular/text-subscript.svg?raw";
import superscript from "@phosphor-icons/core/assets/regular/text-superscript.svg?raw";
import textT from "@phosphor-icons/core/assets/regular/text-t.svg?raw";
import underline from "@phosphor-icons/core/assets/regular/text-underline.svg?raw";
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import undo from "@phosphor-icons/core/assets/regular/arrow-u-up-left.svg?raw";
import redo from "@phosphor-icons/core/assets/regular/arrow-u-up-right.svg?raw";
import warning from "@phosphor-icons/core/assets/regular/warning-circle.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";

const SVG = {
  back: caretLeft, undo, redo, check, export: exportIcon, play, layers: stack, text: textT, sigma,
  shape: square, line: lineSegment, arrow: arrowUpRight, image, video: filmStrip, pen: penNib, rename: pencil, magnet, plus, minus, copy, trash,
  history: clock, library: images, close: x, folder, up: caretUp, down: caretDown, search,
  group: boundingBox, dots, sun, moon, bold, italic, underline, strike, subscript, superscript,
  bullets: listBullets, numbers: listNumbers, alignLeft, alignCenter, alignRight, link, eraser,
  pdf: filePdf, html: fileHtml, zip: fileZip, open: arrowSquareOut, code, warning, cursor, eye, decks: house, globe, lock, publish: cloudUp,
};

export type IconName = keyof typeof SVG;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <span class="od-icon" aria-hidden="true" style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: SVG[name] }} />
  );
}
