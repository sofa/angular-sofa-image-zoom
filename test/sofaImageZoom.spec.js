'use strict';

describe('sofa.imageZoom', function () {

    var $compile, $rootScope;

    beforeEach(module('sofa.imageZoom'));

    beforeEach(inject(function (_$compile_, _$rootScope_) {
        $compile = _$compile_;
        $rootScope = _$rootScope_;
    }));

    it('should run tests', function () {
        expect(true).toBe(true);
    });
});
