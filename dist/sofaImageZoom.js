/**
 * angular-sofa-image-zoom - v0.1.0 - Mon Jan 12 2015 15:23:18 GMT+0100 (CET)
 * http://www.sofa.io
 *
 * Copyright (c) 2014 CouchCommerce GmbH (http://www.couchcommerce.com / http://www.sofa.io) and other contributors
 * THIS SOFTWARE CONTAINS COMPONENTS OF THE SOFA.IO COUCHCOMMERCE SDK (WWW.SOFA.IO)
 * IT IS PROVIDED UNDER THE LICENSE TERMS OF THE ATTACHED LICENSE.TXT.
 */
;(function (angular) {
angular.module('sofa.imageZoom', ['sofa-image-zoom.tpl.html']);

angular.module('sofa-image-zoom.tpl.html', []).run(['$templateCache', function($templateCache) {
  $templateCache.put('sofa-image-zoom.tpl.html',
    '<div class="sofa-image-zoom" ng-class="{\'sofa-image-zoom--active\': active}">\n' +
    '    <img class="sofa-image-zoom__image" ng-src="{{imageSrc}}">\n' +
    '</div>');
}]);

/* global Hammer */

/**
 * Image Zoom.
 * Dependencies: hammerjs (v.2.0)
 *
 */

// TODO: pan and pinch works, while pinch and pan doesn't :(

angular.module('sofa.imageZoom')

.directive('sofaImageZoom', ["$window", "$compile", "$rootScope", "$timeout", "sofaImageZoomService", function ($window, $compile, $rootScope, $timeout, sofaImageZoomService) {

    'use strict';

    if (!angular.isFunction($window.Hammer)) {
        throw new Error('Hammer.js is missing');
    }

    return {
        restrict: 'A',
        templateUrl: 'sofa-image-zoom.tpl.html',
        compile: function (tElement) {

            var scope = $rootScope.$new();

            scope.imageSrc = '';

            scope.closeZoomView = function () {
                scope.active = false;
                scope.imageSrc = '';
                scope.$digest();

                $window.removeEventListener('resize', sofaImageZoomService.adjust);
            };

            scope.openZoomView = function (imgSrc, originalImage) {
                scope.imageSrc = imgSrc;
                scope.active   = true;
                scope.$digest();

                // orientationchange will not work for android, so we use the resize event
                $window.addEventListener('resize', sofaImageZoomService.adjust);

                sofaImageZoomService.setup(originalImage, scope.$zoomImage[0], scope.$zoomContainer[0]);
            };

            scope.$zoomContainer = $compile(tElement.contents())(scope);
            scope.$zoomImage = scope.$zoomContainer.find('img');

            angular.element($window.document.body).prepend(scope.$zoomContainer);

            // Touch stuff
            var mc = new Hammer.Manager(scope.$zoomImage[0]);

            var pinch = new Hammer.Pinch();
            var pan   = new Hammer.Pan();
            var tap   = new Hammer.Tap({
                event: 'doubletap',
                taps: 2,
                posThreshold: 20
            });

            pinch.recognizeWith(pan);

            var sessionEnded = false;

            mc.add([pinch, pan, tap]);

            mc.on('pinchin pinchout', function (e) {
                if (!sessionEnded) {
                    sofaImageZoomService.zoom(e, scope.$zoomImage[0]);
                }
            }).on('pinchstart', function () {
                sessionEnded = false;
            }).on('pinchend', function (e) {
                sessionEnded = true;
                sofaImageZoomService.zoom(e, scope.$zoomImage[0], true);

                if (sofaImageZoomService.getZoomFactor() <= 1) {
                    scope.closeZoomView();
                }
            }).on('pan panend', function (e) {
                sofaImageZoomService.move(e, scope.$zoomImage[0], e.type === 'panend');
            }).on('doubletap', function () {
                if (sofaImageZoomService.getZoomFactor() > 1) {
                    scope.closeZoomView();
                } else {
                    sofaImageZoomService.setZoom(scope.$zoomImage[0], 1.5);
                }
            });

            // This is for the cleanup
            scope.imageScopes = {};

            scope.$watchCollection('imageScopes', function (a) {
                if (!Object.keys(a).length) {
                    scope.$zoomContainer.remove();
                    $timeout(function () {
                        scope.$destroy();
                    }, 0);
                }
            });

            return function ($scope, $element, attrs) {

                // Where does the zoomImage URL come from?
                var getImageSrc = function () {
                    return !!attrs.sofaImageZoom ? $scope.$eval(attrs.sofaImageZoom) : attrs.src;
                };

                $scope.imageSrc = getImageSrc();

                if (!$scope.imageSrc) {
                    var unwatch = $scope.$watch(function () {
                        return getImageSrc();
                    }, function (newVal) {
                        if (newVal && angular.isString(newVal)) {
                            $scope.imageSrc = newVal;
                            unwatch();
                        }
                    });
                }

                var activateZoom = function () {
                    if ($scope.imageSrc) {
                        scope.openZoomView($scope.imageSrc, $element[0]);
                    }
                    // TODO: shall we show a warning until the zoom becomes available?
                };

                var mc = new Hammer.Manager($element[0]);

                var pinch = new Hammer.Pinch();
                var tap   = new Hammer.Tap({
                    event: 'doubletap',
                    taps: 2,
                    posThreshold: 20
                });

                // Helper to prevent another "pinchin/pinchout" after the "pinchend" was fired
                // (pinch fires 2 touchend events)
                var sessionEnded = false;

                mc.add([pinch, tap]);

                mc.on('pinchstart', function () {
                    sessionEnded = false;
                }).on('pinchin pinchout', function (e) {
                    if (!sessionEnded) {
                        if (!scope.active && e.type === 'pinchout') {
                            activateZoom();
                        }
                        sofaImageZoomService.zoom(e, scope.$zoomImage[0]);
                    }
                }).on('doubletap', function () {
                    if (!scope.active) {
                        activateZoom();
                        sofaImageZoomService.setZoom(scope.$zoomImage[0], 1.5, true);
                    }
                }).on('pinchend', function (e) {
                    sessionEnded = true;
                    sofaImageZoomService.zoom(e, scope.$zoomImage[0], true);

                    if (sofaImageZoomService.getZoomFactor() <= 1) {
                        scope.closeZoomView();
                    }
                });

                // Since "scope" is not automatically destroyed, we need to destroy it when
                // all "$scope"'s are destroyed.
                scope.imageScopes[$scope.$id] = $scope;

                $scope.$on('$destroy', function () {
                    delete scope.imageScopes[$scope.$id];
                });
            };
        }
    };
}]);

/* global document */

angular.module('sofa.imageZoom')

.factory('sofaImageZoomService', function () {

    'use strict';

    var TRANSFORM_PROPERTY = 'transform';
    ['webkit', 'Moz', 'O', 'ms'].every(function (prefix) {
        var e = prefix + 'Transform';
        if (document.body.style[e] !== undefined) {
            TRANSFORM_PROPERTY = e;
            return false;
        }
        return true;
    });

    var scaleRegEx     = /scale\([-+]?[0-9]*\.?[0-9]*\)/;
    var translateRegEx = /translate\((-?[0-9]*\.?[0-9]*?px), ?(-?[0-9]*\.?[0-9]*?px)\)/;

    var cache = {};

    cache.zoomFactor = 1;
    // Track the movement (pan) of the zoomed image
    cache.movePosition = {
        x: 0,
        y: 0
    };
    // Cache the original position and dimensions of the image
    cache.basePosition = {
        x: 0,
        y: 0,
        w: 0,
        h: 0
    };
    // Cache the container dimensions
    cache.containerDimensions = {
        w: 0,
        h: 0
    };
    cache.elements = null;
    // Max scale factor depends on the original image and thus is object to change
    cache.maxScale = 3;

    var self = this;

    // Min scale is always 1...
    self.minScale = 1;

    // Some getters
    self.getElements = function () {
        return cache.elements;
    };

    self.getZoomFactor = function () {
        return cache.zoomFactor;
    };

    self.getBasePosition = function () {
        return cache.basePosition;
    };

    self.getContainerDimensions = function () {
        return cache.containerDimensions;
    };

    self.getLimits = function () {
        return cache.limits;
    };

    self.getMaxScale = function () {
        return cache.maxScale;
    };

    // Some setters
    self.setElements = function (original, zoom, container) {
        cache.elements = {
            originalElement: original,
            zoomElement: zoom,
            container: container
        };
    };

    self.setZoomFactor = function (factor) {
        self.resetLimits();
        cache.zoomFactor = factor;
    };

    self.setBasePosition = function (rect) {
        cache.basePosition = {
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        };
    };

    self.setContainerDimensions = function (rect) {
        cache.containerDimensions = {
            w: rect.width,
            h: rect.height
        };
    };

    self.setMovePosition = function (x, y) {
        cache.movePosition = {
            x: x,
            y: y
        };
    };

    self.setLimits = function (limits) {
        cache.limits = limits;
    };

    // Regardless of the real zoom image's size, we should at least zoom to thrice the original size
    self.setMaxScale = function (factor) {
        cache.maxScale = (factor && factor > 3) ? factor : 3;
    };

    // Resetting methods
    self.resetZoomFactor = function () {
        self.setZoomFactor(1);
    };

    self.resetMovePosition = function () {
        self.setMovePosition(0, 0);
    };

    self.resetElementStyles = function (el) {
        el.style[TRANSFORM_PROPERTY] = '';
    };

    self.resetLimits = function () {
        cache.limits = null;
    };

    // ZOOM!
    self.setZoom = function (zoomElement, zoomFactor, save) {
        var scaleValue = 'scale(' + zoomFactor + ')';
        var hasScaleStyle = zoomElement.style[TRANSFORM_PROPERTY].search(/scale/) > -1;

        if (hasScaleStyle) {
            zoomElement.style[TRANSFORM_PROPERTY] = zoomElement.style[TRANSFORM_PROPERTY].replace(scaleRegEx, scaleValue);
        } else {
            zoomElement.style[TRANSFORM_PROPERTY] = zoomElement.style[TRANSFORM_PROPERTY] + ' ' + scaleValue;
        }

        if (save) {
            self.setZoomFactor(zoomFactor);
        }
    };

    self.zoom = function (event, zoomElement, end) {

        var zoomFactor = event.scale * self.getZoomFactor();
        var maxScale   = self.getMaxScale();

        if (zoomFactor < self.minScale) {
            zoomFactor = self.minScale;
        } else if (zoomFactor > maxScale) {
            zoomFactor = maxScale;
        }

        self.setZoom(zoomElement, zoomFactor, end);
    };

    self.checkLimits = function () {

        if (cache.limits) {
            return cache.limits;
        }

        var limits, leftLimit, rightLimit, topLimit, bottomLimit;
        var zoomFactor          = self.getZoomFactor();
        var basePosition        = self.getBasePosition();
        var containerDimensions = self.getContainerDimensions();

        var imageWidth  = zoomFactor * basePosition.w;
        var imageHeight = zoomFactor * basePosition.h;
        var containerWidth  = containerDimensions.w;
        var containerHeight = containerDimensions.h;

        // xPos
        if (imageWidth <= containerWidth) {
            leftLimit  = (containerWidth - imageWidth) / -2;
            rightLimit = (containerWidth - imageWidth) / 2;
        } else {
            leftLimit  = (imageWidth - containerWidth) / -2;
            rightLimit = (imageWidth - containerWidth) / 2;
        }
        // yPos
        if (imageHeight <= containerHeight) {
            topLimit    = (containerHeight - imageHeight) / -2;
            bottomLimit = (containerHeight - imageHeight) / 2;
        } else {
            topLimit    = (imageHeight - containerHeight) / -2;
            bottomLimit = (imageHeight - containerHeight) / 2;
        }

        limits = cache.limits = {
            left:   parseInt(leftLimit / zoomFactor, 10),
            right:  parseInt(rightLimit / zoomFactor, 10),
            top:    parseInt(topLimit / zoomFactor, 10),
            bottom: parseInt(bottomLimit / zoomFactor, 10)
        };

        return limits;
    };

    self.shouldMove = function () {
        var allowX = cache.containerDimensions.w - cache.basePosition.w * cache.zoomFactor < 0;
        var allowY = cache.containerDimensions.h - cache.basePosition.h * cache.zoomFactor < 0;

        return allowX || allowY;
    };

    self.move = function (event, zoomElement, end) {
        var xPos = parseInt(event.deltaX / cache.zoomFactor + cache.movePosition.x, 10);
        var yPos = parseInt(event.deltaY / cache.zoomFactor + cache.movePosition.y, 10);

        if (!self.shouldMove()) {
            return;
        }

        // Check for boundaries
        var limits = self.checkLimits();

        if (xPos < limits.left) {
            xPos = limits.left;
        } else if (xPos > limits.right) {
            xPos = limits.right;
        }
        if (yPos < limits.top) {
            yPos = limits.top;
        } else if (yPos > limits.bottom) {
            yPos = limits.bottom;
        }

        var hasTranslateStyle = zoomElement.style[TRANSFORM_PROPERTY].search(/translate/) > -1;
        var translateValue    = 'translate(' + xPos + 'px, ' + yPos + 'px)';

        if (hasTranslateStyle) {
            zoomElement.style[TRANSFORM_PROPERTY] = zoomElement.style[TRANSFORM_PROPERTY].replace(translateRegEx, translateValue);
        } else {
            zoomElement.style[TRANSFORM_PROPERTY] = zoomElement.style[TRANSFORM_PROPERTY] + ' ' + translateValue;
        }

        if (end) {
            self.setMovePosition(xPos, yPos);
        }
    };

    self.setup = function (originalElement, zoomElement, container, adjust) {
        self.resetZoomFactor();
        self.resetMovePosition();
        self.resetLimits();
        self.resetElementStyles(zoomElement);

        var originalPosition = originalElement.getBoundingClientRect();

        ['left', 'top', 'width', 'height'].forEach(function (property) {
            zoomElement.style[property] = originalPosition[property] + 'px';
        });

        // This one is really WEIRD. But it seems to be the only way to make sure that mobile Safari
        // gets the clientRect right after an orientationchange/resize (from landscape to portrait only, iOS 7.1).
        // Forcing a repaint the right way (e.g., offsetHeight) doesn't work either. And finally, I have no idea
        // why the zoomElement's style affects the clientRect of the original image. Just crazy...
        // Let's at least play it only in case we react on view port changes!
        if (adjust) {
            originalPosition = originalElement.getBoundingClientRect();

            ['left', 'top', 'width', 'height'].forEach(function (property) {
                zoomElement.style[property] = originalPosition[property] + 'px';
            });
        }
        // end of weirdness

        self.setElements(originalElement, zoomElement, container);
        self.setBasePosition(originalPosition);
        self.setMaxScale(zoomElement.naturalWidth / originalPosition.width);
        self.setContainerDimensions(container.getBoundingClientRect());
    };

    self.adjust = function () {
        var elements = self.getElements();
        var oldZoom  = self.getZoomFactor();
        if (elements) {
            self.setup(elements.originalElement, elements.zoomElement, elements.container, true);
            self.setZoom(elements.zoomElement, oldZoom);
            self.setZoomFactor(oldZoom);
        }
    };

    return self;

});
}(angular));
