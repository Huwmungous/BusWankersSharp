using System.Security.Claims;

namespace Autofills.Common
{
    /// <summary>
    /// Reads Keycloak group membership out of a token's claims. Lives in Common
    /// (which has no web dependencies) so the rule is unit-testable on its own;
    /// UploaderService's authorisation handler is a thin wrapper around it.
    ///
    /// Keycloak puts group membership in a "groups" claim when the client has a
    /// Group Membership mapper (the estate's web libraries read the same claim
    /// name - see if-web-common's UserGroups.ts). ASP.NET's JWT handler turns a
    /// JSON array claim into one Claim per element, so membership is simply "is
    /// there a claim of that type with that value". "kc_groups" is what a few
    /// older Infoforum services asked their mapper for, so it is honoured too.
    ///
    /// The mapper's "Full group path" switch decides whether the value is
    /// "uploaders" or "/uploaders"; both are accepted, so the switch cannot
    /// lock anyone out. Only a TOP-LEVEL group matches: "/team/uploaders" is a
    /// different group and does not count. Names are case-sensitive, matching
    /// the front end's own check.
    /// </summary>
    public static class GroupMembership
    {
        /// <summary>The claim types group membership may arrive under.</summary>
        public static readonly IReadOnlyList<string> GroupClaimTypes = new[] { "groups", "kc_groups" };

        /// <summary>"/uploaders" and " uploaders " both become "uploaders".</summary>
        public static string Normalise(string? group) =>
            (group ?? string.Empty).Trim().TrimStart('/');

        /// <summary>Every group the claims put the caller in, normalised, distinct, in first-seen order.</summary>
        public static IReadOnlyList<string> GroupsOf(IEnumerable<Claim> claims)
        {
            var groups = new List<string>();
            foreach (var claim in claims)
            {
                if (!GroupClaimTypes.Contains(claim.Type, StringComparer.Ordinal))
                    continue;

                var name = Normalise(claim.Value);
                if (name.Length > 0 && !groups.Contains(name, StringComparer.Ordinal))
                    groups.Add(name);
            }
            return groups;
        }

        /// <summary>True when the claims put the caller in <paramref name="group"/> (a top-level group name).</summary>
        public static bool IsMember(IEnumerable<Claim> claims, string group)
        {
            var wanted = Normalise(group);
            if (wanted.Length == 0)
                return false;

            return GroupsOf(claims).Contains(wanted, StringComparer.Ordinal);
        }
    }
}
