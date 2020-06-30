import virtualScroll from "virtual-scroll-locomotive";
import Core from "./Core";
import { lerp } from "./utils/maths";
import { getTranslate } from "./utils/transform";
import { getParents, queryClosestParent } from "./utils/html";
import BezierEasing from "bezier-easing";

const keyCodes = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    SPACE: 32,
    TAB: 9,
    PAGEUP: 33,
    PAGEDOWN: 34,
    HOME: 36,
    END: 35,
};

export default class extends Core {
    constructor(options = {}) {
        // ssr
        if (!process.browser) return;

        window.scrollTo(0, 0);
        history.scrollRestoration = "manual";

        super(options);

        if (this.inertia) this.lerp = this.inertia * 0.1;
        this.isScrolling = false;
        this.isDraggingScrollbar = false;
        this.isTicking = false;
        this.hasScrollTicking = false;
        this.parallaxElements = [];
        this.stop = false;

        this.checkKey = this.checkKey.bind(this);
        window.addEventListener("keydown", this.checkKey, false);
    }

    init() {
        this.html.classList.add(this.smoothClass);
        this.html.setAttribute(`data-${this.name}-direction`, this.direction);

        this.instance = {
            delta: {
                x: 0,
                y: 0,
            },
            ...this.instance,
        };

        this.vs = new virtualScroll({
            el: this.scrollFromAnywhere ? document : this.el,
            mouseMultiplier: navigator.platform.indexOf("Win") > -1 ? 1 : 0.4,
            firefoxMultiplier: this.firefoxMultiplier,
            touchMultiplier: this.touchMultiplier,
            useKeyboard: false,
            passive: true,
        });

        this.vs.on((e) => {
            if (this.stop) {
                return;
            }

            if (!this.isTicking && !this.isDraggingScrollbar) {
                requestAnimationFrame(() => {
                    this.updateDelta(e);
                    if (!this.isScrolling) this.startScrolling();
                });
                this.isTicking = true;
            }
            this.isTicking = false;
        });

        this.setScrollLimit();
        this.initScrollBar();
        this.addSections();
        this.addElements();
        this.detectElements();
        this.transformElements(true, true);

        this.checkScroll(true);

        super.init();
    }

    setScrollLimit() {
        this.instance.limit.y = this.el.offsetHeight - this.windowHeight;

        if (this.direction === "horizontal") {
            let totalWidth = 0;
            let nodes = this.el.children;
            for (let i = 0; i < nodes.length; i++) {
                totalWidth += nodes[i].offsetWidth;
            }

            this.instance.limit.x = totalWidth - this.windowWidth;
        }
    }

    startScrolling() {
        this.isScrolling = true;
        this.checkScroll();
        this.html.classList.add(this.scrollingClass);
    }

    stopScrolling() {
        if (this.scrollToRaf) {
            cancelAnimationFrame(this.scrollToRaf);
            this.scrollToRaf = null;
        }

        this.isScrolling = false;
        this.instance.scroll.y = Math.round(this.instance.scroll.y);
        this.html.classList.remove(this.scrollingClass);
    }

    checkKey(e) {
        if (this.stop) {
            // If we are stopped, we don't want any scroll to occur because of a keypress
            // Prevent tab to scroll to activeElement
            if (e.keyCode == keyCodes.TAB) {
                requestAnimationFrame(() => {
                    // Make sure native scroll is always at top of page
                    this.html.scrollTop = 0;
                    document.body.scrollTop = 0;
                });
            }
            return;
        }

        switch (e.keyCode) {
            case keyCodes.TAB:
                // Do not remove the RAF
                // It allows to override the browser's native scrollTo, which is essential
                requestAnimationFrame(() => {
                    // Make sure native scroll is always at top of page
                    this.html.scrollTop = 0;
                    document.body.scrollTop = 0;

                    // Request scrollTo on the focusedElement, putting it at the center of the screen
                    this.scrollTo(
                        document.activeElement,
                        -window.innerHeight / 2
                    );
                });
                break;
            case keyCodes.UP:
                this.instance.delta[this.directionAxis] -= 240;
                break;
            case keyCodes.DOWN:
                this.instance.delta[this.directionAxis] += 240;
                break;
            case keyCodes.PAGEUP:
                this.instance.delta[this.directionAxis] -= window.innerHeight;
                break;
            case keyCodes.PAGEDOWN:
                this.instance.delta[this.directionAxis] += window.innerHeight;
                break;
            case keyCodes.HOME:
                this.instance.delta[this.directionAxis] -= this.instance.limit[
                    this.directionAxis
                ];
                break;
            case keyCodes.END:
                this.instance.delta[this.directionAxis] += this.instance.limit[
                    this.directionAxis
                ];
                break;
            case keyCodes.SPACE:
                if (
                    !(document.activeElement instanceof HTMLInputElement) &&
                    !(document.activeElement instanceof HTMLTextAreaElement)
                ) {
                    if (e.shiftKey) {
                        this.instance.delta[this.directionAxis] -=
                            window.innerHeight;
                    } else {
                        this.instance.delta[this.directionAxis] +=
                            window.innerHeight;
                    }
                }
                break;
            default:
                return;
        }

        if (this.instance.delta[this.directionAxis] < 0)
            this.instance.delta[this.directionAxis] = 0;
        if (this.instance.delta[this.directionAxis] > this.instance.limit)
            this.instance.delta[this.directionAxis] = this.instance.limit;

        this.isScrolling = true;
        this.checkScroll();
        this.html.classList.add(this.scrollingClass);
    }

    checkScroll(forced = false) {
        if (forced || this.isScrolling || this.isDraggingScrollbar) {
            if (!this.hasScrollTicking) {
                requestAnimationFrame(() => this.checkScroll());
                this.hasScrollTicking = true;
            }

            this.updateScroll();

            const distance = Math.abs(
                this.instance.delta[this.directionAxis] -
                    this.instance.scroll[this.directionAxis]
            );
            if (
                !this.animatingScroll &&
                ((distance < 0.5 &&
                    this.instance.delta[this.directionAxis] != 0) ||
                    (distance < 0.5 &&
                        this.instance.delta[this.directionAxis] == 0))
            ) {
                this.stopScrolling();
            }

            for (let i = this.sections.length - 1; i >= 0; i--) {
                if (
                    this.sections[i].persistent ||
                    (this.instance.scroll[this.directionAxis] >
                        this.sections[i].offset[this.directionAxis] &&
                        this.instance.scroll[this.directionAxis] <
                            this.sections[i].limit[this.directionAxis])
                ) {
                    if (this.direction === "horizontal") {
                        this.transform(
                            this.sections[i].el,
                            -this.instance.scroll[this.directionAxis],
                            0
                        );
                    } else {
                        this.transform(
                            this.sections[i].el,
                            0,
                            -this.instance.scroll[this.directionAxis]
                        );
                    }

                    if (!this.sections[i].inView) {
                        this.sections[i].inView = true;
                        this.sections[i].el.style.opacity = 1;
                        this.sections[i].el.style.pointerEvents = "all";
                        this.sections[i].el.setAttribute(
                            `data-${this.name}-section-inview`,
                            ""
                        );
                    }
                } else {
                    if (this.sections[i].inView) {
                        this.sections[i].inView = false;
                        this.sections[i].el.style.opacity = 0;
                        this.sections[i].el.style.pointerEvents = "none";
                        this.sections[i].el.removeAttribute(
                            `data-${this.name}-section-inview`
                        );
                    }

                    this.transform(this.sections[i].el, 0, 0);
                }
            }

            if (this.getDirection) {
                this.addDirection();
            }

            if (this.getSpeed) {
                this.addSpeed();
                this.timestamp = Date.now();
            }

            this.detectElements();
            this.transformElements();

            const scrollBarTranslation =
                (this.instance.scroll[this.directionAxis] /
                    this.instance.limit[this.directionAxis]) *
                this.scrollBarLimit[this.directionAxis];
            if (this.direction === "horizontal") {
                this.transform(this.scrollbarThumb, scrollBarTranslation, 0);
            } else {
                this.transform(this.scrollbarThumb, 0, scrollBarTranslation);
            }

            super.checkScroll();

            this.hasScrollTicking = false;
        }
    }

    resize() {
        this.windowHeight = window.innerHeight;
        this.windowWidth = window.innerWidth;

        this.checkContext();

        this.windowMiddle = {
            x: this.windowWidth / 2,
            y: this.windowHeight / 2,
        };
        this.update();
    }

    updateDelta(e) {
        let delta;
        if (this.isMobile) {
            delta = this[this.context].horizontalGesture ? e.deltaX : e.deltaY;
        } else {
            delta = this.horizontalGesture ? e.deltaX : e.deltaY;
        }

        this.instance.delta[this.directionAxis] -= delta * this.multiplier;

        if (this.instance.delta[this.directionAxis] < 0)
            this.instance.delta[this.directionAxis] = 0;
        if (
            this.instance.delta[this.directionAxis] >
            this.instance.limit[this.directionAxis]
        )
            this.instance.delta[this.directionAxis] = this.instance.limit[
                this.directionAxis
            ];
    }

    updateScroll(e) {
        if (this.isScrolling || this.isDraggingScrollbar) {
            this.instance.scroll[this.directionAxis] = lerp(
                this.instance.scroll[this.directionAxis],
                this.instance.delta[this.directionAxis],
                this.lerp
            );
        } else {
            if (
                this.instance.scroll[this.directionAxis] >
                this.instance.limit[this.directionAxis]
            ) {
                this.setScroll(
                    this.instance.scroll[this.directionAxis],
                    this.instance.limit[this.directionAxis]
                );
            } else if (this.instance.scroll.y < 0) {
                this.setScroll(this.instance.scroll[this.directionAxis], 0);
            } else {
                this.setScroll(
                    this.instance.scroll[this.directionAxis],
                    this.instance.delta[this.directionAxis]
                );
            }
        }
    }

    addDirection() {
        if (this.instance.delta.y > this.instance.scroll.y) {
            if (this.instance.direction !== "down") {
                this.instance.direction = "down";
            }
        } else if (this.instance.delta.y < this.instance.scroll.y) {
            if (this.instance.direction !== "up") {
                this.instance.direction = "up";
            }
        }

        if (this.instance.delta.x > this.instance.scroll.x) {
            if (this.instance.direction !== "right") {
                this.instance.direction = "right";
            }
        } else if (this.instance.delta.x < this.instance.scroll.x) {
            if (this.instance.direction !== "left") {
                this.instance.direction = "left";
            }
        }
    }

    addSpeed() {
        if (
            this.instance.delta[this.directionAxis] !=
            this.instance.scroll[this.directionAxis]
        ) {
            this.instance.speed =
                (this.instance.delta[this.directionAxis] -
                    this.instance.scroll[this.directionAxis]) /
                Math.max(1, Date.now() - this.timestamp);
        } else {
            this.instance.speed = 0;
        }
    }

    initScrollBar() {
        this.scrollbar = document.createElement("span");
        this.scrollbarThumb = document.createElement("span");
        this.scrollbar.classList.add(`${this.scrollbarClass}`);
        this.scrollbarThumb.classList.add(`${this.scrollbarClass}_thumb`);

        this.scrollbar.append(this.scrollbarThumb);
        document.body.append(this.scrollbar);

        // Scrollbar Events
        this.getScrollBar = this.getScrollBar.bind(this);
        this.releaseScrollBar = this.releaseScrollBar.bind(this);
        this.moveScrollBar = this.moveScrollBar.bind(this);

        this.scrollbarThumb.addEventListener("mousedown", this.getScrollBar);
        window.addEventListener("mouseup", this.releaseScrollBar);
        window.addEventListener("mousemove", this.moveScrollBar);

        // Set scrollbar values
        if (this.direction == "horizontal") {
            if (this.instance.limit.x + this.windowWidth <= this.windowWidth) {
                return;
            }
        } else {
            if (
                this.instance.limit.y + this.windowHeight <=
                this.windowHeight
            ) {
                return;
            }
        }

        this.scrollbarHeight = this.scrollbar.getBoundingClientRect().height;
        this.scrollbarWidth = this.scrollbar.getBoundingClientRect().width;

        if (this.direction === "horizontal") {
            this.scrollbarThumb.style.width = `${
                (this.scrollbarWidth * this.scrollbarWidth) /
                (this.instance.limit.x + this.scrollbarWidth)
            }px`;
        } else {
            this.scrollbarThumb.style.height = `${
                (this.scrollbarHeight * this.scrollbarHeight) /
                (this.instance.limit.y + this.scrollbarHeight)
            }px`;
        }

        this.scrollBarLimit = {
            x:
                this.scrollbarWidth -
                this.scrollbarThumb.getBoundingClientRect().width,
            y:
                this.scrollbarHeight -
                this.scrollbarThumb.getBoundingClientRect().height,
        };
    }

    reinitScrollBar() {
        if (this.instance.limit + this.windowHeight <= this.windowHeight) {
            return;
        }

        this.scrollbarHeight = this.scrollbar.getBoundingClientRect().height;
        this.scrollbarWidth = this.scrollbar.getBoundingClientRect().width;

        if (this.direction === "horizontal") {
            this.scrollbarThumb.style.width = `${
                (this.scrollbarWidth * this.scrollbarWidth) /
                (this.instance.limit.x + this.scrollbarWidth)
            }px`;
        } else {
            this.scrollbarThumb.style.height = `${
                (this.scrollbarHeight * this.scrollbarHeight) /
                (this.instance.limit.y + this.scrollbarHeight)
            }px`;
        }
        this.scrollBarLimit = {
            x:
                this.scrollbarWidth -
                this.scrollbarThumb.getBoundingClientRect().width,
            y:
                this.scrollbarHeight -
                this.scrollbarThumb.getBoundingClientRect().height,
        };
    }

    destroyScrollBar() {
        this.scrollbarThumb.removeEventListener("mousedown", this.getScrollBar);
        window.removeEventListener("mouseup", this.releaseScrollBar);
        window.removeEventListener("mousemove", this.moveScrollBar);
        this.scrollbar.remove();
    }

    getScrollBar(e) {
        this.isDraggingScrollbar = true;
        this.checkScroll();
        this.html.classList.remove(this.scrollingClass);
        this.html.classList.add(this.draggingClass);
    }

    releaseScrollBar(e) {
        this.isDraggingScrollbar = false;
        this.html.classList.add(this.scrollingClass);
        this.html.classList.remove(this.draggingClass);
    }

    moveScrollBar(e) {
        if (!this.isTicking && this.isDraggingScrollbar) {
            requestAnimationFrame(() => {
                let x =
                    (((e.clientX * 100) / this.scrollbarWidth) *
                        this.instance.limit.x) /
                    100;
                let y =
                    (((e.clientY * 100) / this.scrollbarHeight) *
                        this.instance.limit.y) /
                    100;

                if (y > 0 && y < this.instance.limit.y) {
                    this.instance.delta.y = y;
                }
                if (x > 0 && x < this.instance.limit.x) {
                    this.instance.delta.x = x;
                }
            });
            this.isTicking = true;
        }
        this.isTicking = false;
    }

    addElements() {
        this.els = [];
        this.parallaxElements = [];

        this.sections.forEach((section, y) => {
            const els = this.sections[y].el.querySelectorAll(
                `[data-${this.name}]`
            );

            els.forEach((el, id) => {
                let cl = el.dataset[this.name + "Class"] || this.class;
                let top;
                let left;
                let repeat = el.dataset[this.name + "Repeat"];
                let call = el.dataset[this.name + "Call"];
                let position = el.dataset[this.name + "Position"];
                let delay = el.dataset[this.name + "Delay"];
                let direction = el.dataset[this.name + "Direction"];
                let sticky =
                    typeof el.dataset[this.name + "Sticky"] === "string";
                let speed = el.dataset[this.name + "Speed"]
                    ? parseFloat(el.dataset[this.name + "Speed"]) / 10
                    : false;
                let offset =
                    typeof el.dataset[this.name + "Offset"] === "string"
                        ? el.dataset[this.name + "Offset"].split(",")
                        : this.offset;

                let target = el.dataset[this.name + "Target"];
                let targetEl;

                if (target !== undefined) {
                    targetEl = document.querySelector(`${target}`);
                } else {
                    targetEl = el;
                }

                if (!this.sections[y].inView) {
                    top =
                        targetEl.getBoundingClientRect().top -
                        getTranslate(this.sections[y].el).y -
                        getTranslate(targetEl).y;
                    left =
                        targetEl.getBoundingClientRect().left -
                        getTranslate(this.sections[y].el).x -
                        getTranslate(targetEl).x;
                } else {
                    top =
                        targetEl.getBoundingClientRect().top +
                        this.instance.scroll.y -
                        getTranslate(targetEl).y;
                    left =
                        targetEl.getBoundingClientRect().left +
                        this.instance.scroll.x -
                        getTranslate(targetEl).x;
                }

                let bottom = top + targetEl.offsetHeight;
                let right = left + targetEl.offsetWidth;
                let middle = {
                    x: (right - left) / 2 + left,
                    y: (bottom - top) / 2 + top,
                };

                if (sticky) {
                    const elTop = el.getBoundingClientRect().top;
                    const elLeft = el.getBoundingClientRect().left;

                    const elDistance = {
                        x: elLeft - left,
                        y: elTop - top,
                    };

                    top += window.innerHeight;
                    left += window.innerWidth;
                    bottom =
                        elTop +
                        targetEl.offsetHeight -
                        el.offsetHeight -
                        elDistance[this.directionAxis];
                    right =
                        elLeft +
                        targetEl.offsetWidth -
                        el.offsetWidth -
                        elDistance[this.directionAxis];
                    middle = {
                        x: (right - left) / 2 + left,
                        y: (bottom - top) / 2 + top,
                    };
                }

                if (repeat == "false") {
                    repeat = false;
                } else if (repeat != undefined) {
                    repeat = true;
                } else {
                    repeat = this.repeat;
                }

                let relativeOffset = [0, 0];
                if (offset) {
                    if (this.direction === "horizontal") {
                        for (var i = 0; i < offset.length; i++) {
                            if (typeof offset[i] == "string") {
                                if (offset[i].includes("%")) {
                                    relativeOffset[i] = parseInt(
                                        (offset[i].replace("%", "") *
                                            this.windowWidth) /
                                            100
                                    );
                                } else {
                                    relativeOffset[i] = parseInt(offset[i]);
                                }
                            } else {
                                relativeOffset[i] = offset[i];
                            }
                        }
                        left = left + relativeOffset[0];
                        right = right - relativeOffset[1];
                    } else {
                        for (var i = 0; i < offset.length; i++) {
                            if (typeof offset[i] == "string") {
                                if (offset[i].includes("%")) {
                                    relativeOffset[i] = parseInt(
                                        (offset[i].replace("%", "") *
                                            this.windowHeight) /
                                            100
                                    );
                                } else {
                                    relativeOffset[i] = parseInt(offset[i]);
                                }
                            } else {
                                relativeOffset[i] = offset[i];
                            }
                        }
                        top = top + relativeOffset[0];
                        bottom = bottom - relativeOffset[1];
                    }
                }

                const mappedEl = {
                    el,
                    id: id,
                    class: cl,
                    top,
                    middle,
                    bottom,
                    left,
                    right,
                    offset,
                    repeat,
                    inView: el.classList.contains(cl) ? true : false,
                    call,
                    speed,
                    delay,
                    position,
                    target: targetEl,
                    direction,
                    sticky,
                };

                this.els.push(mappedEl);

                if (speed !== false || sticky) {
                    this.parallaxElements.push(mappedEl);
                }
            });
        });
    }

    addSections() {
        this.sections = [];

        let sections = this.el.querySelectorAll(`[data-${this.name}-section]`);
        if (sections.length === 0) {
            sections = [this.el];
        }

        sections.forEach((section, i) => {
            let offset = {
                x:
                    section.getBoundingClientRect().left -
                    window.innerWidth * 1.5 -
                    getTranslate(section).x,
                y:
                    section.getBoundingClientRect().top -
                    window.innerHeight * 1.5 -
                    getTranslate(section).y,
            };
            let limit = {
                x:
                    offset.x +
                    section.getBoundingClientRect().width +
                    window.innerWidth * 2,
                y:
                    offset.y +
                    section.getBoundingClientRect().height +
                    window.innerHeight * 2,
            };
            let persistent =
                typeof section.dataset[this.name + "Persistent"] === "string";

            const mappedSection = {
                el: section,
                offset: offset,
                limit: limit,
                inView: false,
                persistent: persistent,
            };

            this.sections[i] = mappedSection;
        });
    }

    transform(element, x, y, delay) {
        let transform;

        if (!delay) {
            transform = `matrix3d(1,0,0.00,0,0.00,1,0.00,0,0,0,1,0,${x},${y},0,1)`;
        } else {
            let start = getTranslate(element);
            let lerpX = lerp(start.x, x, delay);
            let lerpY = lerp(start.y, y, delay);

            transform = `matrix3d(1,0,0.00,0,0.00,1,0.00,0,0,0,1,0,${lerpX},${lerpY},0,1)`;
        }

        element.style.webkitTransform = transform;
        element.style.msTransform = transform;
        element.style.transform = transform;
    }

    transformElements(isForced, setAllElements = false) {
        const scrollRight = this.instance.scroll.x + this.windowWidth;
        const scrollBottom = this.instance.scroll.y + this.windowHeight;

        const scrollMiddle = {
            x: this.instance.scroll.x + this.windowMiddle.x,
            y: this.instance.scroll.y + this.windowMiddle.y,
        };

        this.parallaxElements.forEach((current, i) => {
            let transformDistance = false;

            if (isForced) {
                transformDistance = 0;
            }

            if (current.inView || setAllElements) {
                switch (current.position) {
                    case "top":
                        transformDistance =
                            this.instance.scroll[this.directionAxis] *
                            -current.speed;
                        break;

                    case "elementTop":
                        transformDistance =
                            (scrollBottom - current.top) * -current.speed;
                        break;

                    case "bottom":
                        transformDistance =
                            (this.instance.limit[this.directionAxis] -
                                scrollBottom +
                                this.windowHeight) *
                            current.speed;
                        break;

                    case "left":
                        transformDistance =
                            this.instance.scroll[this.directionAxis] *
                            -current.speed;
                        break;

                    case "elementLeft":
                        transformDistance =
                            (scrollRight - current.left) * -current.speed;
                        break;

                    case "right":
                        transformDistance =
                            (this.instance.limit[this.directionAxis] -
                                scrollRight +
                                this.windowHeight) *
                            current.speed;
                        break;

                    default:
                        transformDistance =
                            (scrollMiddle[this.directionAxis] -
                                current.middle[this.directionAxis]) *
                            -current.speed;
                        break;
                }
            }

            if (current.sticky) {
                if (current.inView) {
                    if (this.direction === "horizontal") {
                        transformDistance =
                            this.instance.scroll.x -
                            current.left +
                            window.innerWidth;
                    } else {
                        transformDistance =
                            this.instance.scroll.y -
                            current.top +
                            window.innerHeight;
                    }
                } else {
                    if (this.direction === "horizontal") {
                        if (
                            this.instance.scroll.x <
                                current.left - window.innerWidth &&
                            this.instance.scroll.x <
                                current.left - window.innerWidth / 2
                        ) {
                            transformDistance = 0;
                        } else if (
                            this.instance.scroll.x > current.right &&
                            this.instance.scroll.x > current.right + 100
                        ) {
                            transformDistance =
                                current.right -
                                current.left +
                                window.innerWidth;
                        } else {
                            transformDistance = false;
                        }
                    } else {
                        if (
                            this.instance.scroll.y <
                                current.top - window.innerHeight &&
                            this.instance.scroll.y <
                                current.top - window.innerHeight / 2
                        ) {
                            transformDistance = 0;
                        } else if (
                            this.instance.scroll.y > current.bottom &&
                            this.instance.scroll.y > current.bottom + 100
                        ) {
                            transformDistance =
                                current.bottom -
                                current.top +
                                window.innerHeight;
                        } else {
                            transformDistance = false;
                        }
                    }
                }
            }

            if (transformDistance !== false) {
                if (
                    current.direction === "horizontal" ||
                    (this.direction === "horizontal" &&
                        current.direction !== "vertical")
                ) {
                    this.transform(
                        current.el,
                        transformDistance,
                        0,
                        isForced ? false : current.delay
                    );
                } else {
                    this.transform(
                        current.el,
                        0,
                        transformDistance,
                        isForced ? false : current.delay
                    );
                }
            }
        });
    }

    /**
     * Scroll to a desired target.
     *
     * @param  Available options :
     *          targetOption {node, string, "top", "bottom", int} - The DOM element we want to scroll to
     *          offsetOption {int} - An offset to apply on top of given `target` or `sourceElem`'s target
     *          duration {int} - Duration of the scroll animation in milliseconds
     *          easing {array} - An array of 4 floats between 0 and 1 defining the bezier curve for the animation's easing. See http://greweb.me/bezier-easing-editor/example/
     * @return {void}
     */
    scrollTo(
        targetOption,
        offsetOption,
        duration = 1000,
        easing = [0.25, 0.0, 0.35, 1.0],
        disableLerp = false,
        callback
    ) {
        // TODO - In next breaking update, use an object as 2nd parameter for options (offset, duration, easing, disableLerp, callback)
        let target;
        let offset = offsetOption ? parseInt(offsetOption) : 0;
        easing = BezierEasing(...easing);

        if (typeof targetOption === "string") {
            // Selector or boundaries
            if (targetOption === "top") {
                target = 0;
            } else if (targetOption === "bottom") {
                target = this.instance.limit.y;
            } else if (targetOption === "left") {
                target = 0;
            } else if (targetOption === "right") {
                target = this.instance.limit.x;
            } else {
                target = document.querySelector(targetOption);
                // If the query fails, abort
                if (!target) {
                    return;
                }
            }
        } else if (typeof targetOption === "number") {
            // Absolute coordinate
            target = parseInt(targetOption);
        } else if (targetOption && targetOption.tagName) {
            // DOM Element
            target = targetOption;
        } else {
            console.warn("`targetOption` parameter is not valid");
            return;
        }

        // We have a target that is not a coordinate yet, get it
        if (typeof target !== "number") {
            // Verify the given target belongs to this scroll scope
            let targetInScope = getParents(target).includes(this.el);
            if (!targetInScope) {
                // If the target isn't inside our main element, abort any action
                return;
            }

            // Get target offset from top
            const targetBCR = target.getBoundingClientRect();
            const offsetTop = targetBCR.top;
            const offsetLeft = targetBCR.left;

            // Try and find the target's parent section
            const targetParents = getParents(target);
            const parentSection = targetParents.find((candidate) =>
                this.sections.find((section) => section.el == candidate)
            );
            let parentSectionOffset = 0;
            if (parentSection) {
                parentSectionOffset = getTranslate(parentSection)[
                    this.directionAxis
                ]; // We got a parent section, store it's current offset to remove it later
            }
            // Final value of scroll destination : offsetTop + (optional offset given in options) - (parent's section translate)
            if (this.direction === "horizontal") {
                offset = offsetLeft + offset - parentSectionOffset;
            } else {
                offset = offsetTop + offset - parentSectionOffset;
            }
        } else {
            offset = target + offset;
        }

        // Actual scrollto
        // ==========================================================================

        // Setup
        const scrollStart = parseFloat(this.instance.delta[this.directionAxis]);
        const scrollTarget = Math.max(
            0,
            Math.min(offset, this.instance.limit[this.directionAxis])
        ); // Make sure our target is in the scroll boundaries
        const scrollDiff = scrollTarget - scrollStart;
        const render = (p) => {
            if (disableLerp) {
                if (this.direction === "horizontal") {
                    this.setScroll(
                        scrollStart + scrollDiff * p,
                        this.instance.delta.y
                    );
                } else {
                    this.setScroll(
                        this.instance.delta.x,
                        scrollStart + scrollDiff * p
                    );
                }
            } else {
                this.instance.delta[this.directionAxis] =
                    scrollStart + scrollDiff * p;
            }
        };

        // Prepare the scroll
        this.animatingScroll = true; // This boolean allows to prevent `checkScroll()` from calling `stopScrolling` when the animation is slow (i.e. at the beginning of an EaseIn)
        this.stopScrolling(); // Stop any movement, allows to kill any other `scrollTo` still happening
        this.startScrolling(); // Restart the scroll

        // Start the animation loop
        const start = Date.now();
        const loop = () => {
            var p = (Date.now() - start) / duration; // Animation progress

            if (p > 1) {
                // Animation ends
                render(1);
                this.animatingScroll = false;

                if (duration == 0) this.update();
                if (callback) callback();
            } else {
                this.scrollToRaf = requestAnimationFrame(loop);
                render(easing(p));
            }
        };
        loop();
    }

    update() {
        this.setScrollLimit();
        this.addSections();
        this.addElements();
        this.detectElements();
        this.updateScroll();
        this.transformElements(true);
        this.reinitScrollBar();

        this.checkScroll(true);
    }

    startScroll() {
        this.stop = false;
    }

    stopScroll() {
        this.stop = true;
    }

    setScroll(x, y) {
        this.instance = {
            ...this.instance,
            scroll: {
                x: x,
                y: y,
            },
            delta: {
                x: x,
                y: y,
            },
            speed: 0,
        };
    }

    destroy() {
        super.destroy();

        this.stopScrolling();
        this.html.classList.remove(this.smoothClass);
        this.vs.destroy();
        this.destroyScrollBar();
        window.removeEventListener("keydown", this.checkKey, false);
    }
}
