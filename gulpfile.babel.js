import fs from "fs";
import gulp from "gulp";
import sass from "gulp-dart-sass";
import bundle from "./build/bundle-js";
import {
    bundleWithCacheForDevelopment,
    reload,
    serve
} from "./build/dev-server";

const sources = {
    js: "./src/**/*.js",
    standaloneJs: "./src/full-boundary-survey.js",
    standaloneCss: "./sass/full-boundary-survey.scss",
    css: "./sass/**/*.scss",
    html: "./html/*.html",
    assets: "./assets/**",
    deployFiles: "./deploy/**"
};

export const clean = () => new Promise(resolve => fs.rmdir("./docs", resolve));

//export const deployFiles = () =>
//    gulp.src(sources.deployFiles).pipe(gulp.dest("./docs"));

export const js = () => bundle();

export const standaloneJs = () =>
    gulp.src(sources.standaloneJs).pipe(gulp.dest("./docs"));

export const previewStandaloneJs = () =>
    gulp.src(sources.standaloneJs).pipe(gulp.dest("./html"));

export const css = () =>
    gulp
        .src(sources.css)
        .pipe(sass())
        .pipe(gulp.dest("./docs/"));

export const css_min = () =>
    gulp
        .src(sources.css)
        .pipe(sass({outputStyle: 'compressed'}))
        .pipe(gulp.dest("./docs/"));

export const previewStandaloneCss = () =>
    gulp
        .src(sources.standaloneCss)
        .pipe(sass())
        .pipe(gulp.dest("./html/"));

export const html = () => gulp.src(sources.html).pipe(gulp.dest("./docs"));

export const assets = () =>
    gulp.src(sources.assets).pipe(gulp.dest("./docs/assets"));

export const build = gulp.series(
    clean,
    //gulp.parallel(js, css, html, assets, deployFiles)
    gulp.parallel(js, standaloneJs, previewStandaloneJs, css_min, previewStandaloneCss, html, assets)
);

export const devBuild = gulp.series(
    clean,
    gulp.parallel(bundleWithCacheForDevelopment, standaloneJs, previewStandaloneJs, css, previewStandaloneCss, html, assets)
);

export const watch = () => {
    gulp.watch(sources.css, gulp.series(css, previewStandaloneCss, reload));
    gulp.watch(sources.html, gulp.series(html, reload));
    gulp.watch(sources.js, gulp.series(bundleWithCacheForDevelopment, standaloneJs, previewStandaloneJs, reload));
    gulp.watch(sources.assets, gulp.series(assets));
};

export const develop = gulp.series(devBuild, serve, watch);
