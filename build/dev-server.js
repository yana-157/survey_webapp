import browserSync from "browser-sync";
import bundle from "./bundle-js";

const server = browserSync.create();

export function reload(done) {
    server.reload();
    done();
}

export function serve(done) {
    server.init({
        notify: false,
        middleware: [
            (req, res, next) => {
                res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
                res.setHeader("Pragma", "no-cache");
                res.setHeader("Expires", "0");
                next();
            }
        ],
        server: {
            baseDir: "./docs/",
            serveStaticOptions: {
                extensions: ["html"] // pretty urls
            }
        }
    });
    done();
}

let caches = {};
export function bundleWithCacheForDevelopment() {
    return bundle(false, caches);
}
