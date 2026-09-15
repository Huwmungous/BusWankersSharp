using IFGlobal.WebServices;

// =============================================================================
// BUSWANKERSSHARP UPLOADERSERVICE
// =============================================================================
// Spreadsheet -> autofill-file generation for the BusWankers registration
// system. Bootstrapped through IFGlobal's ServiceFactory, matching every
// other Infoforum-estate web service (SampleWebService/ChitterChatterWebService
// are the reference implementations this follows) - see Infoforum PR #382 for
// the deploy-pipeline side of this move (deploys queeg -> intelligence now,
// alongside the estate's other backend services, instead of self-hosting on
// queeg):
//   - Kestrel listens on whatever port IFGlobal.PortResolver assigns this app
//     (UploaderService -> 5038; see PortResolver.cs), not a hardcoded
//     appsettings.json Kestrel URL - so the old "Kestrel:Endpoints:Http:Url"
//     block is gone from appsettings.json.
//   - IFLogger ships this service's logs to LoggerWebService like every other
//     estate web service (UseIFLogger = true) - no manual wiring needed here.
//   - UseAuthentication is false: this service isn't gated by Keycloak - its
//     own protection is the shared upload password checked in the autofill
//     controller (see UploadPassword in appsettings.json), unchanged from
//     before. ServiceFactory still runs its ConfigWebService/Keycloak
//     bootstrap dance regardless of that flag (it needs an authenticated
//     HttpClient to ship logs to LoggerWebService) - see appsettings.json's
//     "IF" section for the AppDomain this authenticates against, and
//     deploy-buswankers-backend.sh's preflight for what has to be provisioned
//     first.
//   - ClientSecretEnvVar is overridden to BUSWANKERS_CLIENTSECRET: BusWankers
//     gets its own AppDomain/Keycloak client (like RozeBowl and BreakTackle
//     each have their own), so its secret lives under its own name in
//     /etc/sysconfig/if-secrets rather than colliding with IF_CLIENTSECRET
//     (reserved for Infoforum-domain services) or ROZEBOWL_CLIENTSECRET.
//   - ServiceFactory's default "AllowAll" CORS policy replaces the old
//     hand-rolled DevCorsPolicy - same effect (an unauthenticated npm dev
//     server on a different origin can still reach a locally-run copy of
//     this service while developing the upload page), one less thing to
//     hand-maintain here.
//   - AddHealthController wires GET /Health automatically - the old manual
//     "/health" MapGet is gone; deploy-buswankers-backend.sh's verify phase
//     now checks /Health to match.
//
// Deliberately no UseHttpsRedirection(): this service only ever listens on
// plain HTTP behind holly's nginx, which terminates TLS for
// https://longmanrd.net/ and reverse-proxies to it over the LAN - redirecting
// to HTTPS here would just break that proxied traffic.
// =============================================================================

var app = await ServiceFactory.CreateAsync(new ServiceFactoryOptions
{
    ServiceName = "UploaderService",
    Description = "BusWankersSharp spreadsheet -> autofill-file generation",
    UseAuthentication = false,
    UseIFLogger = true,
    ClientSecretEnvVar = "BUSWANKERS_CLIENTSECRET"
});

app.Run();
