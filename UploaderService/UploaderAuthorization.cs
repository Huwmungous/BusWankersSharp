using System.Security.Claims;
using Autofills.Common;
using Microsoft.AspNetCore.Authorization;

namespace Autofills.UploaderService;

/// <summary>
/// The "Uploaders" authorisation policy (2026-09-29): only members of the
/// Keycloak group "uploaders" may change what the live autofill files hold -
/// POST /ingest, and the two routes that read an uploaded workbook (/sheets,
/// /generate). Everything else needs only a signed-in user.
///
/// It is checked on the server, on every request, from the group claim in the
/// validated access token - the front end hides the Update Files tab from
/// non-members purely as a courtesy. A signed-in user who isn't in the group
/// gets 403 (an unauthenticated caller still gets 401 from the controller's
/// class-level [Authorize] first).
///
/// The group name defaults to "uploaders" and can be overridden with the
/// "Auth:UploadersGroup" setting; the Keycloak client must carry a Group
/// Membership mapper (claim name "groups", added to the access token) or no
/// one will ever be recognised - see GroupMembership and the README.
/// </summary>
public static class UploaderAuthorization
{
    /// <summary>Policy name for [Authorize(Policy = ...)].</summary>
    public const string PolicyName = "Uploaders";

    /// <summary>The Keycloak group whose members may upload.</summary>
    public const string DefaultGroup = "uploaders";

    /// <summary>appsettings key that overrides <see cref="DefaultGroup"/>.</summary>
    public const string GroupSettingKey = "Auth:UploadersGroup";

    /// <summary>
    /// Registers the requirement handler and the policy. Additive with what
    /// ServiceFactory already registered (AddAuthorizationBuilder composes
    /// rather than replaces, as IFOllama's own policy registration relies on).
    /// </summary>
    public static IServiceCollection AddUploadersAuthorisation(this IServiceCollection services, IConfiguration configuration)
    {
        var configured = GroupMembership.Normalise(configuration[GroupSettingKey]);
        var group = configured.Length > 0 ? configured : DefaultGroup;

        services.AddSingleton<IAuthorizationHandler, UploadersHandler>();
        services.AddAuthorizationBuilder()
            .AddPolicy(PolicyName, policy => policy
                .RequireAuthenticatedUser()
                .AddRequirements(new UploadersRequirement(group)));

        return services;
    }
}

/// <summary>"The caller is in this Keycloak group."</summary>
public sealed class UploadersRequirement : IAuthorizationRequirement
{
    public UploadersRequirement(string group) => Group = group;

    public string Group { get; }
}

/// <summary>
/// Satisfies <see cref="UploadersRequirement"/> from the token's group claims,
/// and logs the outcome - who was let in or turned away, and which groups the
/// token actually carried - so a "why can't I upload?" report can be answered
/// from the log (an empty group list there means the Keycloak mapper is missing).
/// </summary>
public sealed class UploadersHandler : AuthorizationHandler<UploadersRequirement>
{
    private readonly ILogger<UploadersHandler> _log;

    public UploadersHandler(ILogger<UploadersHandler> log) => _log = log;

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, UploadersRequirement requirement)
    {
        // Nothing to say about an anonymous caller: RequireAuthenticatedUser
        // fails the policy on its own, and the challenge is a 401.
        if (context.User.Identity?.IsAuthenticated != true)
            return Task.CompletedTask;

        var caller = CallerName(context.User);
        var groups = GroupMembership.GroupsOf(context.User.Claims);

        if (GroupMembership.IsMember(context.User.Claims, requirement.Group))
        {
            _log.LogDebug("Uploaders check passed for {Caller}: member of group {Group}", caller, requirement.Group);
            context.Succeed(requirement);
        }
        else
        {
            // Not Fail(): leaving the requirement unmet is enough, and lets
            // any other handler for the requirement still have its say.
            _log.LogWarning("Uploaders check refused {Caller}: not in group {Group} (token groups: [{Groups}])",
                caller, requirement.Group, string.Join(", ", groups));
        }

        return Task.CompletedTask;
    }

    // Same order of preference as UploadServiceController.CallerName.
    private static string CallerName(ClaimsPrincipal user) =>
        user.FindFirstValue("preferred_username")
        ?? user.Identity?.Name
        ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? user.FindFirstValue("sub")
        ?? "unknown";
}
